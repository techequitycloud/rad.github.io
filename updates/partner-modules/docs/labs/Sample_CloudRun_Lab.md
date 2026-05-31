# Sample Application on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Sample_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

This lab deploys the Sample reference application on Cloud Run (v2). It is a simple Flask application that demonstrates the full App_CloudRun module feature set: Cloud SQL (PostgreSQL), Filestore NFS via gen2 execution environment, GCS Fuse mounts, Redis integration, Secret Manager, Direct VPC Egress, and Cloud Monitoring with uptime checks.

Use this module to understand typical Cloud Run application module patterns before studying production modules like Django_CloudRun.

### What the Module Automates

- Builds (or mirrors) the sample Flask container image to Artifact Registry
- Creates a Cloud SQL PostgreSQL database user and database
- Stores the database password and Flask secret key in Secret Manager
- Deploys a Cloud Run v2 service with Cloud SQL Auth Proxy integration
- Mounts a Cloud Filestore NFS instance into the Cloud Run service (gen2 execution environment)
- Creates a GCS bucket and mounts it via GCS Fuse
- Configures Direct VPC Egress for private network connectivity
- Enables Cloud Monitoring uptime checks and alert policies
- Optionally configures traffic splitting and revision retention policies

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Access the sample application in a browser or with `curl`
- Explore application endpoints: health check, database connectivity, GCP metadata
- Inspect Cloud Run service configuration, revisions, and traffic splits in the Cloud Console
- Observe auto-scaling behaviour
- Review request logs and metrics in Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

```bash
# Cloud Run service management
gcloud run services describe <service-name> --region <region> --project <project>
gcloud run services list --project <project>
gcloud run revisions list --service <service-name> --region <region> --project <project>

# Application access
curl https://<service-url>/
curl https://<service-url>/health
curl https://<service-url>/db

# Cloud Run REST API
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/<project>/locations/<region>/services/<service>"
```

---

## Prerequisites

- Services_GCP deployed in the same GCP project (provides VPC, Cloud SQL, Filestore, and Artifact Registry)
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- `curl` installed
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Suffix appended to resource names |
| `tenant_deployment_id` | No | `demo` | Unique identifier for this deployment |
| `region` | No | `us-central1` | GCP region for Cloud Run service |
| `application_name` | No | `cloudrunapp` | Internal identifier used in resource naming |
| `application_version` | No | `latest` | Container image version tag |
| `deploy_application` | No | `true` | Deploy the Cloud Run service |
| `min_instance_count` | No | `0` | Minimum instances (0 = scale to zero) |
| `max_instance_count` | No | `1` | Maximum instances (cost ceiling) |
| `cpu_limit` | No | `1000m` | CPU allocated per container instance |
| `memory_limit` | No | `512Mi` | Memory allocated per container instance |
| `application_database_name` | No | `cloudrunapp` | PostgreSQL database name |
| `application_database_user` | No | `cloudrunapp` | PostgreSQL user name |
| `enable_nfs` | No | `true` | Mount a Cloud Filestore NFS volume |
| `nfs_mount_path` | No | `/mnt/nfs` | Container path for the NFS mount |
| `enable_redis` | No | `false` | Enable Redis integration |
| `redis_host` | No | `""` | Redis server hostname or IP |
| `redis_port` | No | `6379` | Redis server port |
| `ingress_settings` | No | `all` | Traffic sources allowed (`all`, `internal`, `internal-and-cloud-load-balancing`) |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing (`ALL_TRAFFIC` or `PRIVATE_RANGES_ONLY`) |
| `execution_environment` | No | `gen2` | Cloud Run execution environment (`gen2` required for NFS) |
| `max_revisions_to_retain` | No | `7` | Number of old revisions to keep |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Estimated Deployment Duration

| Phase | Duration |
|---|---|
| Cloud SQL database and user creation | 1–2 min |
| Secret Manager secrets | < 1 min |
| Cloud Build image build (if `container_image_source = custom`) | 2–4 min |
| Cloud Run service deployment | 1–3 min |
| NFS and GCS Fuse volume attachment | 1–2 min |
| Uptime check provisioning | 1 min |
| **Total** | **6–13 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `service_location` | Region where the service is deployed |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | PostgreSQL database name |
| `database_user` | PostgreSQL user name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `nfs_mount_path` | NFS volume mount path inside the container |
| `nfs_share_path` | NFS share path on the Filestore server |
| `storage_buckets` | GCS bucket names created for the application |
| `deployment_id` | Generated deployment suffix |
| `container_image` | Full image URI used for the Cloud Run service |
| `uptime_check_names` | Names of Cloud Monitoring uptime checks |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")
```

---

## Phase 2 — Access the Sample Application [MANUAL]

### Steps

1. Access the application root to confirm it is running:

   ```bash
   curl "${SERVICE_URL}/"
   ```

   **Expected result:** The Flask application responds with a welcome page or JSON payload. On the first request after a period of inactivity, the response may take 1–3 seconds as Cloud Run cold-starts a new instance.

2. Test the health endpoint:

   ```bash
   curl "${SERVICE_URL}/health"
   ```

   **Expected result:** JSON response `{"status": "ok"}` or similar. This endpoint is used by the Cloud Run startup and liveness probes.

3. Test the database connectivity endpoint:

   ```bash
   curl "${SERVICE_URL}/db"
   ```

   **Expected result:** JSON response confirming a successful PostgreSQL connection via the Cloud SQL Auth Proxy, showing database name, user, and optionally a test query result.

4. Explore the GCP metadata endpoint:

   ```bash
   curl "${SERVICE_URL}/metadata"
   ```

   **Expected result:** JSON response showing Cloud Run metadata such as project ID, region, service name, and revision name — retrieved from the instance metadata server.

5. Open `${SERVICE_URL}` in a browser to explore the application visually.

   **gcloud REST API equivalent:**
   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format=json | jq '.status.url'
   ```

---

## Phase 3 — Explore Cloud Run Features [MANUAL]

### Steps

1. View the Cloud Run service details in the console:

   Navigate to **Cloud Run** in the Google Cloud Console, find the service, and click it.

   Alternatively, use gcloud:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **Expected result:** Service details including the URL, container image, resource limits, environment variables, volume mounts, and VPC egress configuration.

2. List revisions to see the deployment history:

   ```bash
   gcloud run revisions list \
     --service ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **Expected result:** A list of revisions with their creation time, active status, and traffic percentage. The `max_revisions_to_retain` variable controls how many older revisions are kept.

3. Examine traffic allocation across revisions. By default, 100% of traffic goes to the latest revision:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="value(spec.traffic)"
   ```

   **Expected result:** Traffic configuration showing `latestRevision: true` and `percent: 100`.

4. Observe auto-scaling. By default, `min_instance_count = 0` so instances scale to zero after the request timeout period. Send a burst of requests to trigger scale-up:

   ```bash
   for i in {1..20}; do
     curl -s "${SERVICE_URL}/health" &
   done
   wait
   ```

5. In the Cloud Console under the service's **Metrics** tab, observe the **Instance count** metric spike in response to the requests, then scale back toward zero.

6. Inspect the VPC egress configuration and Direct VPC Egress attachment:

   ```bash
   gcloud run services describe ${SERVICE} \
     --region ${REGION} \
     --project ${PROJECT} \
     --format="json" | jq '.spec.template.metadata.annotations'
   ```

   **Expected result:** Annotations showing `run.googleapis.com/vpc-access-connector` or direct VPC egress configuration, confirming private network connectivity for Cloud SQL and NFS access.

7. If `max_revisions_to_retain = 7` (default), older revisions beyond this count are automatically pruned. View the Cloud Run service in the console and observe that only the most recent revisions are retained.

   **Cloud Run REST API equivalent:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}/revisions"
   ```

---

## Phase 4 — Cloud Logging and Monitoring [MANUAL]

### Steps

1. View Cloud Run request logs using `gcloud`:

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --format=json
   ```

2. In the Google Cloud Console, navigate to **Logging > Log Explorer** and filter:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   ```

   **Expected result:** Structured HTTP request log entries showing method, URL path, response code, latency, and the revision name that served each request.

3. Filter for application-level logs (Flask logs):

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   severity>=WARNING
   ```

4. In the Cloud Console, navigate to the Cloud Run service and click the **Logs** tab for a pre-filtered view of request and application logs.

5. In the Cloud Console, navigate to **Monitoring > Uptime checks**. Find the uptime check created by the module and verify its status is `Passing`. Uptime checks probe the application from multiple Google global locations every 60 seconds.

   **gcloud equivalent:**
   ```bash
   gcloud monitoring uptime list-configs \
     --project=${PROJECT}
   ```

6. In the Cloud Console, navigate to **Monitoring > Metrics Explorer** and explore Cloud Run metrics:

   - **Request count:** `run.googleapis.com/request_count` — total requests per second
   - **Request latency:** `run.googleapis.com/request_latencies` — response time percentiles (p50, p95, p99)
   - **Active instances:** `run.googleapis.com/container/instance_count` — observe scale-up and scale-down
   - **Container memory:** `run.googleapis.com/container/memory/utilizations`

7. In the Cloud Console, navigate to the Cloud Run service and click the **Metrics** tab for a pre-filtered dashboard showing all of the above metrics for the service.

---

## Phase 5 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

This removes the Cloud Run service, all revisions, Cloud SQL database and user, Secret Manager secrets, Filestore NFS instance, GCS bucket, and uptime checks.

> **Note:** The Cloud SQL instance, Filestore instance, VPC, and Artifact Registry are managed by Services_GCP and are not destroyed by this action.

**Expected duration:** 3–7 minutes.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI deploys Cloud SQL, NFS, GCS, secrets, and Cloud Run service |
| Phase 2 — Access Application | MANUAL | `curl` the service URL, test `/health` and `/db` endpoints |
| Phase 3 — Explore Cloud Run Features | MANUAL | Inspect revisions, traffic splits, auto-scaling, and VPC egress |
| Phase 4 — Logging and Monitoring | MANUAL | View request logs, uptime check status, and Cloud Run metrics |
| Phase 5 — Undeploy | AUTOMATED | RAD UI removes all module resources |
