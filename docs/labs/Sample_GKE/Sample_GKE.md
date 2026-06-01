---
title: "Sample Application on GKE — Lab Guide"
sidebar_label: "Sample GKE"
---

# Sample Application on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Sample_GKE)**

## Overview

**Estimated time:** 1.5–2 hours

This lab deploys the Sample reference application on GKE Autopilot. It is a simple Flask application that demonstrates the full App GKE module feature set: Cloud SQL (PostgreSQL), Filestore NFS, GCS Fuse volume mounts, Redis integration, Workload Identity, Secret Manager, and Cloud Monitoring with uptime checks.

Use this module to understand typical application module patterns before building or studying production modules like Django GKE.

### What the Module Automates

- Builds the sample Flask container image using Cloud Build and pushes it to Artifact Registry
- Creates a Kubernetes namespace and Deployment for the Flask application
- Provisions a Cloud SQL PostgreSQL database user and database
- Stores the database password and Flask secret key in Secret Manager
- Mounts the Cloud SQL Auth Proxy as a sidecar for Unix socket database connections
- Provisions a Cloud Filestore NFS instance and mounts it into the pod
- Creates a GCS bucket and mounts it via GCS Fuse CSI driver
- Configures Workload Identity for the pod service account
- Reserves a static external IP and creates a LoadBalancer Kubernetes Service
- Enables Cloud Monitoring uptime checks and alerting
- Applies a PodDisruptionBudget to protect availability

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Obtain GKE cluster credentials with `gcloud`
- Verify the Flask application pod is running
- Access the sample application via the external LoadBalancer IP
- Explore application endpoints: GCP metadata, health check, database connectivity test
- Examine Kubernetes resources: Deployment, Service, ServiceAccount, volume mounts
- Inspect the Workload Identity binding and Secret Manager configuration
- View application logs in Cloud Logging
- Monitor pod metrics and uptime check status in Cloud Monitoring

---

## CLI and REST API Overview

```bash
# GKE cluster access
gcloud container clusters get-credentials <cluster> --region <region> --project <project>

# Kubernetes workload inspection
kubectl get deployment -n <namespace>
kubectl describe deployment -n <namespace>
kubectl get pod -n <namespace>
kubectl logs -l app=<app> -n <namespace>

# Application access
curl http://<external-ip>/
curl http://<external-ip>/health
curl http://<external-ip>/db

# Secret Manager
gcloud secrets list --project <project>
gcloud secrets versions access latest --secret=<secret-name> --project <project>
```

---

## Prerequisites

- Services GCP deployed in the same GCP project (provides VPC, GKE Autopilot cluster, Cloud SQL, Filestore, and Artifact Registry)
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- `kubectl` installed
- `curl` installed
- Access to the RAD UI with permission to deploy modules in the target GCP project

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Sample GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Suffix appended to resource names |
| `tenant_deployment_id` | No | `demo` | Unique identifier for this deployment |
| `region` | No | `us-central1` | GCP region |
| `application_name` | No | `sample` | Internal identifier used in resource naming |
| `application_version` | No | `latest` | Container image version tag |
| `deploy_application` | No | `true` | Deploy the GKE workload |
| `min_instance_count` | No | `0` | Minimum pod replicas (0 = scale to zero when idle) |
| `max_instance_count` | No | `3` | Maximum pod replicas for HPA scaling |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="512Mi"}` | Pod CPU and memory limits |
| `application_database_name` | No | `sampledb` | PostgreSQL database name |
| `application_database_user` | No | `sampleuser` | PostgreSQL user name |
| `enable_nfs` | No | `true` | Mount a Cloud Filestore NFS volume |
| `nfs_mount_path` | No | `/mnt/nfs` | Container path for the NFS mount |
| `enable_redis` | No | `false` | Enable Redis integration |
| `redis_host` | No | `""` | Redis server hostname or IP |
| `redis_port` | No | `6379` | Redis server port |
| `gke_cluster_name` | No | `""` | GKE cluster name; leave empty to auto-discover |
| `namespace_name` | No | `""` | Kubernetes namespace; leave empty to auto-generate |
| `service_type` | No | `LoadBalancer` | Kubernetes Service type |
| `reserve_static_ip` | No | `true` | Reserve a static external IP |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Deploy

Click **Deploy** in the RAD UI.

### Estimated Deployment Duration

| Phase | Duration |
|---|---|
| Cloud SQL database and user creation | 1–2 min |
| Secret Manager secrets | < 1 min |
| Cloud Build image build and push | 2–4 min |
| Static IP reservation | 1–2 min |
| Kubernetes namespace, Deployment, Service | 2–4 min |
| NFS setup and GCS Fuse mount | 2–3 min |
| **Total** | **8–16 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | Application URL (http://&lt;external-ip>) |
| `service_external_ip` | External IP of the LoadBalancer Service |
| `service_name` | Kubernetes Service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | PostgreSQL database name |
| `database_user` | PostgreSQL user name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `nfs_mount_path` | NFS volume mount path inside the container |
| `storage_buckets` | GCS bucket names created for the application |
| `deployment_id` | Generated deployment suffix |
| `container_image` | Full image URI used for the Deployment |

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

# Discover the namespace (pattern: appsample<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appsample" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~sample" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Steps

1. Obtain GKE cluster credentials:

   ```bash
   gcloud container clusters get-credentials <cluster-name> \
     --region <region> \
     --project <project-id>
   ```

   **gcloud REST equivalent:**
   ```bash
   gcloud container clusters list --project <project-id>
   ```

2. Verify the sample application pod is running:

   ```bash
   kubectl get pods -n ${NAMESPACE}
   ```

   **Expected result:**
   ```
   NAME                               READY   STATUS    RESTARTS   AGE
   sample-<suffix>-xxxxxxx-xxxxx      2/2     Running   0          5m
   ```

   > The pod shows `2/2` because the Cloud SQL Auth Proxy runs as a sidecar alongside the Flask application container.

3. Retrieve the external IP of the LoadBalancer Service:

   ```bash
   kubectl get svc -n ${NAMESPACE}
   ```

   **Expected result:** The LoadBalancer Service shows an `EXTERNAL-IP`.

   **gcloud REST equivalent:**
   ```bash
   gcloud compute addresses list --project <project-id>
   ```

---

## Phase 3 — Access the Sample Application [MANUAL]

### Steps

1. Access the application root to confirm it is running:

   ```bash
   curl "http://${EXTERNAL_IP}/"
   ```

   **Expected result:** The Flask application responds with a welcome page or JSON payload showing it is alive.

2. Test the health endpoint:

   ```bash
   curl "http://${EXTERNAL_IP}/health"
   ```

   **Expected result:** JSON response `{"status": "ok"}` or similar. This endpoint is also used by the Kubernetes liveness probe.

3. Test the database connectivity endpoint:

   ```bash
   curl "http://${EXTERNAL_IP}/db"
   ```

   **Expected result:** JSON response showing a successful PostgreSQL connection, the database name, and optionally a row count. This confirms the Cloud SQL Auth Proxy sidecar is working and the application can reach the database.

4. Explore the GCP metadata endpoint (if the sample app exposes one):

   ```bash
   curl "http://${EXTERNAL_IP}/metadata"
   ```

   **Expected result:** JSON response showing instance metadata such as project ID, region, instance name, and service account email — retrieved from the GKE node metadata server.

5. Open the URL in a browser to explore the application visually.

---

## Phase 4 — Explore Module Patterns [MANUAL]

This phase examines the Kubernetes resources created by the App GKE Foundation Module to understand how application module patterns are implemented.

### Steps

1. Describe the Deployment to see environment variables, volume mounts, and resource limits:

   ```bash
   kubectl describe deployment -n ${NAMESPACE}
   ```

   **Expected result:** Deployment spec showing:
   - Two containers: the Flask app and the Cloud SQL Auth Proxy sidecar
   - Environment variables: `DB_NAME`, `DB_USER`, `DB_HOST` (via Cloud SQL socket path), `SECRET_KEY` (from Secret Manager), `REDIS_HOST`, `REDIS_PORT`
   - Volume mounts: `/cloudsql` (Cloud SQL socket), `/mnt/nfs` (Filestore NFS), and any GCS Fuse mounts

2. Inspect the Kubernetes ServiceAccount and Workload Identity binding:

   ```bash
   kubectl get serviceaccount -n ${NAMESPACE}
   kubectl describe serviceaccount <sa-name> -n ${NAMESPACE}
   ```

   **Expected result:** The ServiceAccount has the annotation `iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com` linking it to a GCP service account via Workload Identity.

   **gcloud equivalent (verify IAM binding):**
   ```bash
   gcloud iam service-accounts get-iam-policy <gsa>@<project>.iam.gserviceaccount.com \
     --project <project-id>
   ```

3. Check the NFS PersistentVolumeClaim:

   ```bash
   kubectl get pvc -n ${NAMESPACE}
   ```

   **Expected result:** A PVC bound to a Filestore NFS share, using the `standard-rwx` or similar StorageClass with `ReadWriteMany` access mode.

4. Inspect Secret Manager secrets created for the application:

   ```bash
   gcloud secrets list --project <project-id> --filter="name~<deployment-id>"
   ```

   **Expected result:** Secrets for the database password (`DB_PASSWORD_*`) and Flask secret key (`SECRET_KEY_*`).

5. Verify the application can access the GCS bucket via GCS Fuse by checking the mounted path:

   ```bash
   kubectl exec -it <pod-name> -n ${NAMESPACE} -c <app-container> -- ls /mnt/gcs
   ```

   **Expected result:** The GCS Fuse mount is visible inside the container (directory listing may be empty on first access).

6. View the Horizontal Pod Autoscaler configuration:

   ```bash
   kubectl get hpa -n ${NAMESPACE}
   ```

   **Expected result:** HPA targeting the Deployment with `MINPODS` and `MAXPODS` matching the `min_instance_count` and `max_instance_count` variables.

---

## Phase 5 — Cloud Logging and Monitoring [MANUAL]

### Steps

1. View application logs using `kubectl`:

   ```bash
   kubectl logs -l app=<app-name> -n ${NAMESPACE} -c <app-container> --tail=100
   ```

   **Expected result:** Flask request logs showing HTTP requests from the uptime check probe and any requests you made in Phase 3.

2. View Cloud SQL Auth Proxy sidecar logs:

   ```bash
   kubectl logs -l app=<app-name> -n ${NAMESPACE} -c cloud-sql-proxy --tail=50
   ```

   **Expected result:** Proxy startup messages and connection establishment logs showing the Cloud SQL instance connection string.

3. In the Google Cloud Console, navigate to **Logging > Log Explorer** and filter by:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   ```

4. **gcloud** equivalent:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=<project-id> \
     --limit=50
   ```

5. In the Cloud Console, navigate to **Monitoring > Uptime checks**. Find the uptime check created by the module (named after the application and deployment ID) and verify it shows `Passing`.

   **gcloud equivalent:**
   ```bash
   gcloud monitoring uptime list-configs --project=<project-id>
   ```

6. In the Cloud Console, navigate to **Monitoring > Metrics Explorer** and plot:
   - **Pod CPU utilisation:** `kubernetes.io/container/cpu/request_utilization` filtered by `namespace_name = ${NAMESPACE}`
   - **Pod memory usage:** `kubernetes.io/container/memory/used_bytes` filtered by `namespace_name = ${NAMESPACE}`

7. Navigate to **Kubernetes Engine > Workloads** in the Cloud Console, select the sample Deployment, and explore the built-in **Observability** tab.

---

## Phase 6 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module: the Kubernetes Deployment, Service, namespace, Cloud SQL database and user, Secret Manager secrets, Filestore NFS instance, GCS bucket, and static IP.

> **Note:** The Cloud SQL instance, GKE cluster, Filestore instance, and VPC are managed by Services GCP and are not affected.

**Expected duration:** 5–10 minutes.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI deployment builds image, provisions DB, NFS, GCS, and deploys GKE workload |
| Phase 2 — kubectl Access | MANUAL | `gcloud container clusters get-credentials`, verify pod and external IP |
| Phase 3 — Access Application | MANUAL | `curl` the root, `/health`, and `/db` endpoints |
| Phase 4 — Explore Module Patterns | MANUAL | Inspect Deployment, Workload Identity, PVC, and Secret Manager integration |
| Phase 5 — Logging and Monitoring | MANUAL | View pod logs, uptime check status, and CPU/memory metrics |
| Phase 6 — Undeploy | AUTOMATED | RAD UI removes all module resources |
