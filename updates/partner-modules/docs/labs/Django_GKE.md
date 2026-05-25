# Django on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Django_GKE)**

## Overview

This module deploys a production-ready Django application on Google Kubernetes Engine (GKE) Autopilot. It provisions a Kubernetes Deployment with Cloud SQL (PostgreSQL) for the database, Cloud Filestore (NFS) for shared persistent storage, GCS for media storage, and Secret Manager for credential management. Workload Identity is used to grant least-privilege GCP access to pods without storing service account keys.

**Estimated time:** 2–3 hours

### What the Module Automates

- GKE namespace, Deployment (or StatefulSet), Service, and HPA creation
- Cloud Build image build and push to Artifact Registry
- Cloud SQL database and user provisioning
- Secret Manager secrets for database credentials and Django settings
- Cloud Filestore NFS instance provisioning and GCS Fuse volume configuration
- Workload Identity binding between the Kubernetes service account and GCP service account
- Cloud Monitoring uptime checks and alert policies
- Static external IP reservation and optional custom domain via Gateway API

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Configure `kubectl` access to the GKE cluster
- Inspect running pods and Kubernetes resources
- Retrieve admin credentials from Secret Manager and log in to Django Admin
- Explore database migrations via init job status
- Upload and verify media files through Django Admin
- Query application logs in Cloud Logging
- View GKE dashboards, pod metrics, and uptime checks in Cloud Monitoring
- Scale the Deployment and observe HPA behaviour

---

## CLI and REST API Overview

Set these shell variables at the start of each session — all gcloud and REST examples below reference them.

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster name (auto-created by Services_GCP)
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format='value(name)' \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
# Example with defaults: appdjangodemo<deployment_id>
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appdjango" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="value(name)" \
  --limit=1)
```

---

## Prerequisites

| Requirement | Detail |
|---|---|
| Access to the RAD UI | Permission to deploy modules in the target GCP project |
| gcloud CLI | Authenticated (`gcloud auth login`) |
| kubectl | Installed and on PATH |
| GCP project with billing | Active billing account linked |
| Services_GCP module deployed | Provides VPC, GKE cluster, Cloud SQL, Artifact Registry, and Filestore |
| Service account | `roles/owner` granted in the target project |

The `Services_GCP` module **must** be deployed and healthy before running this module. It supplies the shared VPC, GKE Autopilot cluster, Cloud SQL instance, Artifact Registry repository, and Filestore NFS server that Django_GKE discovers automatically at deploy time.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Variables are configured in the RAD UI form before deploying. The table below lists the key user-facing variables.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID to deploy into |
| `deployment_id` | _(auto-generated)_ | Short alphanumeric suffix appended to all resource names |
| `region` | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | `demo` | Unique tenant/environment identifier used in resource naming |
| `application_name` | `django` | Base name for the application; used in resource names |
| `application_version` | `latest` | Container image version tag |
| `deploy_application` | `true` | Set to `false` to provision secrets/storage only without deploying the GKE workload |
| `min_instance_count` | `0` | Minimum pod replicas (0 = scale to zero when idle) |
| `max_instance_count` | `1` | Maximum pod replicas; acts as a cost ceiling |
| `gke_cluster_name` | `""` | Target cluster name — leave empty to auto-discover from Services_GCP |
| `gke_cluster_selection_mode` | `primary` | Cluster selection strategy: `explicit`, `round-robin`, or `primary` |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits for each Django pod |
| `application_database_name` | `gkeapp` | PostgreSQL database name created in Cloud SQL |
| `application_database_user` | `gkeapp` | PostgreSQL user created for the application |
| `enable_redis` | `false` | Enable Redis for Django session storage and caching |
| `redis_host` | `""` | Redis hostname/IP (required when `enable_redis = true`) |
| `redis_port` | `6379` | Redis port |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

**Expected resource provisioning times:**

| Resource | Typical duration |
|---|---|
| Kubernetes namespace and RBAC | 1–2 minutes |
| Cloud Build image build | 5–10 minutes |
| Database and user creation | 2–5 minutes |
| Secret Manager secrets | < 1 minute |
| NFS setup job | 2–4 minutes |
| GKE Deployment rollout | 3–8 minutes |
| Uptime check and alert policies | 1–2 minutes |
| **Total** | **15–30 minutes** |

> **Note:** On the very first deploy of a new inline GKE cluster, the `kubernetes_ready` output will be `false` because the cluster endpoint is not yet readable. A second deploy may be required to complete Kubernetes resource deployment.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `kubernetes_ready` | `true` when all Kubernetes workload resources have been deployed successfully |

After deployment, discover further resource details using gcloud and kubectl as shown in the phases below.

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

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appdjango" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~django" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Step 2.1 — Retrieve Cluster Credentials

1. Discover the cluster name and fetch credentials:

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list \
    --project=${PROJECT} \
    --format='value(name)' \
    --limit=1) \
  --region=${REGION} \
  --project=${PROJECT}
```

2. Verify the context is active:

```bash
kubectl config current-context
```

**Expected result:** A context line referencing your project and cluster, e.g. `gke_my-gcp-project_us-central1_gke-cluster-1`.

> **gcloud equivalent:**
> ```bash
> gcloud container clusters list --project=${PROJECT} --region=${REGION}
> ```
>
> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
>   | jq '.clusters[] | {name, status, endpoint}'
> ```

### Step 2.2 — Verify Pods Are Running

1. Set the namespace variable (the pattern is `app<application_name><tenant_deployment_id><deployment_id>`):

```bash
# List namespaces to find yours
kubectl get namespaces | grep django
```

2. Check pod status:

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more pods with status `Running`, e.g.:

```
NAME                      READY   STATUS    RESTARTS   AGE
django-7d9f8b6c4-xq2pj   2/2     Running   0          5m
```

The `2/2` indicates the Django container and the Cloud SQL Auth Proxy sidecar are both running.

> **gcloud equivalent:**
> ```bash
> gcloud container clusters list --project=${PROJECT}
> ```

### Step 2.3 — Check the Service External IP

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned, e.g.:

```
NAME     TYPE           CLUSTER-IP     EXTERNAL-IP     PORT(S)        AGE
django   LoadBalancer   10.96.100.50   34.123.45.67    80:31234/TCP   5m
```

Record the external IP — this is your application URL.

> **gcloud equivalent:**
> ```bash
> gcloud compute forwarding-rules list --project=${PROJECT} --filter="region:${REGION}"
> ```
>
> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
>   | jq '{name, status, endpoint}'
> ```

---

## Phase 3 — Explore the Django Application [MANUAL]

### Step 3.1 — Access the Application

1. Export the service IP:

```bash
export APP_IP=$(kubectl get service django -n ${NAMESPACE} \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Application URL: http://${APP_IP}"
```

2. Open `http://<EXTERNAL-IP>` in your browser.

**Expected result:** The Django application home page loads.

### Step 3.2 — Retrieve the Admin Password from Secret Manager

1. List secrets for your deployment:

```bash
gcloud secrets list --project=${PROJECT} --filter="name~django"
```

2. Access the Django admin password secret (the secret name follows the pattern `<resource_prefix>-django-admin-password` or similar):

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**Expected result:** The admin password is printed to stdout. Copy it.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
>   | jq -r '.payload.data' | base64 --decode
> ```

### Step 3.3 — Log In to Django Admin

1. Navigate to `http://<EXTERNAL-IP>/admin` in your browser.
2. Log in with username `admin` (or as configured) and the password retrieved in Step 3.2.

**Expected result:** The Django administration dashboard appears, showing groups, users, and any registered application models.

### Step 3.4 — Explore the Admin Interface

1. Click **Users** under the Authentication and Authorisation section.
2. Create a new user by clicking **Add User**, filling in the form, and saving.
3. Navigate back to the dashboard and review available model types.

**Expected result:** User is created and listed in the Users table.

---

## Phase 4 — Database and Migrations [MANUAL]

### Step 4.1 — Inspect the Cloud SQL Instance

```bash
gcloud sql instances list --project=${PROJECT}
```

Navigate to **Cloud SQL** in the Google Cloud Console and click your instance to view connection details, storage, and flags.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
>   | jq '.items[] | {name, state, databaseVersion, region}'
> ```

### Step 4.2 — Verify Database Migrations Completed

Migrations run via a Kubernetes init job during deployment. Check its status:

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** The `db-init` job shows `COMPLETIONS: 1/1`:

```
NAME      COMPLETIONS   DURATION   AGE
db-init   1/1           45s        10m
```

To view the migration logs:

```bash
kubectl logs job/db-init -n ${NAMESPACE}
```

**Expected result:** Log output showing Django migration steps, ending with `0 unapplied migration(s)`.

### Step 4.3 — List Databases in Cloud SQL

```bash
gcloud sql databases list \
  --instance=$(gcloud sql instances list --project=${PROJECT} --format='value(name)' --limit=1) \
  --project=${PROJECT}
```

**Expected result:** Your application database appears in the list.

> **REST API equivalent:**
> ```bash
> INSTANCE=$(gcloud sql instances list --project=${PROJECT} --format='value(name)' --limit=1)
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${INSTANCE}/databases" \
>   | jq '.items[] | {name, charset}'
> ```

---

## Phase 5 — Static Files and Media Storage [MANUAL]

### Step 5.1 — Explore the GCS Bucket for Media Files

1. List the GCS buckets created by this module:

```bash
gcloud storage ls --project=${PROJECT} | grep django
```

2. List the contents of the data bucket:

```bash
gcloud storage ls gs://<bucket-name>/
```

**Expected result:** Bucket exists and may contain media directories created by Django's `collectstatic` or file upload operations.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" \
>   | jq '.items[] | select(.name | test("django")) | {name, location, storageClass}'
> ```

### Step 5.2 — Verify GCS Fuse Mount

Check that the GCS Fuse CSI driver has mounted the bucket inside the pod:

```bash
POD=$(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n ${NAMESPACE} ${POD} -c django -- df -h | grep fuse
```

**Expected result:** A fuse filesystem entry appears, mounted at the configured GCS volume path.

### Step 5.3 — Test File Upload Through Django Admin

1. In the Django Admin interface, navigate to a model that supports file attachments (or create one if your application includes media fields).
2. Upload a test image or document.

**Expected result:** The file appears in the GCS bucket under the appropriate path.

```bash
gcloud storage ls -r gs://<bucket-name>/
```

### Step 5.4 — Check the NFS Mount

The NFS mount (`/mnt/nfs` by default) provides shared persistent storage across all pod replicas.

```bash
kubectl exec -n ${NAMESPACE} ${POD} -c django -- df -h /mnt/nfs
```

**Expected result:** An NFS filesystem appears, mounted from the Filestore instance IP.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Logs in the Console

Navigate to **Logging > Logs Explorer** in the Cloud Console.

### Step 6.2 — Query Django Application Logs

**All Django application logs:**
```
resource.type="k8s_container"
resource.labels.project_id="${PROJECT}"
resource.labels.cluster_name="${CLUSTER}"
resource.labels.namespace_name="${NAMESPACE}"
```

**Django error logs only:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
```

**Django HTTP access logs (requests):**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
textPayload=~"GET|POST|PUT|DELETE"
```

**Cloud SQL Auth Proxy sidecar logs:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cloud-sql-proxy"
```

> **gcloud equivalent:**
> ```bash
> gcloud logging read \
>   'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
>   --project=${PROJECT} \
>   --limit=50 \
>   --format="table(timestamp,severity,textPayload)"
> ```
>
> **REST API equivalent:**
> ```bash
> curl -s -X POST -H "Authorization: Bearer ${TOKEN}" \
>   -H "Content-Type: application/json" \
>   "https://logging.googleapis.com/v2/entries:list" \
>   -d '{
>     "resourceNames": ["projects/'${PROJECT}'"],
>     "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'${NAMESPACE}'\"",
>     "orderBy": "timestamp desc",
>     "pageSize": 20
>   }' | jq '.entries[] | {timestamp, severity, textPayload}'
> ```

---

## Phase 7 — Explore Cloud Monitoring [MANUAL]

### Step 7.1 — View the GKE Dashboard

Navigate to **Monitoring > Dashboards** and select the GKE dashboard for your cluster. You will see:
- Node CPU and memory utilisation
- Pod count and restart events
- Network ingress/egress

### Step 7.2 — View Pod CPU and Memory Metrics

In the Metrics Explorer, use the following queries:

**Pod CPU utilisation:**
```
fetch k8s_container
| metric 'kubernetes.io/container/cpu/core_usage_time'
| filter (resource.namespace_name == '${NAMESPACE}')
| align rate(1m)
| every 1m
```

**Pod memory usage:**
```
fetch k8s_container
| metric 'kubernetes.io/container/memory/used_bytes'
| filter (resource.namespace_name == '${NAMESPACE}')
| every 1m
```

> **gcloud equivalent:**
> ```bash
> gcloud monitoring metrics list \
>   --filter="metric.type:kubernetes.io/container" \
>   --project=${PROJECT}
> ```

### Step 7.3 — Check Uptime Checks

Navigate to **Monitoring > Uptime checks** to view the uptime check configured by the deployment.

**Expected result:** The check shows green/passing status against your application's external IP.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
>   | jq '.uptimeCheckConfigs[] | {displayName, httpCheck, period}'
> ```

---

## Phase 8 — Scaling and Updates [MANUAL]

### Step 8.1 — Manually Scale the Deployment

Scale the deployment up to 3 replicas:

```bash
kubectl scale deployment django -n ${NAMESPACE} --replicas=3
```

Watch pods come up:

```bash
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** Three pods reach `Running` status within 1–2 minutes.

Scale back down:

```bash
kubectl scale deployment django -n ${NAMESPACE} --replicas=1
```

> **REST API equivalent:**
> ```bash
> # Patch the deployment replicas via the Kubernetes API
> curl -s -X PATCH \
>   -H "Authorization: Bearer $(gcloud auth print-access-token)" \
>   -H "Content-Type: application/merge-patch+json" \
>   "https://<CLUSTER_ENDPOINT>/apis/apps/v1/namespaces/${NAMESPACE}/deployments/django" \
>   -d '{"spec":{"replicas":3}}'
> ```

### Step 8.2 — Trigger a Rolling Update

To trigger a rolling update, return to the RAD UI, navigate to your deployment, update the `application_version` variable, and click **Update**. Monitor the rollout with:

```bash
kubectl rollout status deployment/django -n ${NAMESPACE}
```

**Expected result:** Output like `Waiting for deployment "django" rollout to finish: 1 out of 1 new replicas have been updated...` followed by `deployment "django" successfully rolled out`.

### Step 8.3 — View the HPA

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current and desired replica counts, along with CPU utilisation percentages.

> **gcloud equivalent:**
> ```bash
> gcloud container clusters describe ${CLUSTER} \
>   --region=${REGION} \
>   --project=${PROJECT} \
>   --format="yaml(nodePools[].autoscaling)"
> ```

---

## Phase 9 — Undeploy Infrastructure [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Expected destroy times:**

| Resource | Typical duration |
|---|---|
| Kubernetes workloads and namespace | 2–4 minutes |
| Secret Manager secrets | < 1 minute |
| GCS buckets | 1–2 minutes |
| Cloud SQL database and user | 1–2 minutes |
| Static IP reservation | < 1 minute |
| **Total** | **8–15 minutes** |

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Configure variables in RAD UI | 1.1 | Manual |
| Build and deploy Django to GKE | 1.2 | Automated |
| Configure kubectl access | 2 | Manual |
| Verify pods and service IP | 2 | Manual |
| Access Django app and admin panel | 3 | Manual |
| Retrieve admin password from Secret Manager | 3 | Manual |
| Verify database migrations | 4 | Manual |
| Explore GCS media storage and NFS mount | 5 | Manual |
| Query logs in Cloud Logging | 6 | Manual |
| View GKE metrics and uptime checks | 7 | Manual |
| Scale deployment and trigger rolling update | 8 | Manual |
| Undeploy all module resources | 9 | Automated |
