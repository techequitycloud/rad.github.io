---
title: "App_GKE — Lab Guide"
sidebar_label: "App GKE"
---

# App_GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)**

## Overview

`App_GKE` is the **foundation deployment engine** for all GKE Autopilot application modules in this repository. It is a highly parameterized Terraform child module that provisions a production-ready Kubernetes workload on GKE Autopilot, including Cloud SQL (PostgreSQL or MySQL), Cloud Filestore NFS, GCS storage, Secret Manager, Workload Identity, Cloud Build CI/CD, Cloud Monitoring, and optional Cloud Armor WAF.

Application modules such as `Django_GKE`, `Ghost_GKE`, and `Wordpress_GKE` call this module and pass application-specific configuration. You can also call `App_GKE` directly to deploy a generic containerised workload on GKE Autopilot.

**Estimated time:** 2–3 hours

### What the Module Automates

- GKE namespace, Deployment (or StatefulSet), Service, and HPA creation
- Cloud Build image build and push to Artifact Registry (custom mode) or image mirroring (prebuilt mode)
- Cloud SQL database and user provisioning, with Cloud SQL Auth Proxy sidecar
- Secret Manager secrets for database credentials and application settings
- Cloud Filestore NFS provisioning and GCS Fuse volume configuration
- Workload Identity binding between the Kubernetes service account and GCP service account
- Kubernetes Jobs for initialisation tasks (e.g. `db-init`) and CronJobs for scheduled tasks
- Cloud Monitoring uptime checks and alert policies
- Optional: Cloud Armor WAF + Ingress, Identity-Aware Proxy, VPC Service Controls, CI/CD trigger, static IP reservation

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Configure `kubectl` access to the GKE cluster
- Inspect running pods and Kubernetes resources
- Retrieve credentials from Secret Manager and access the application
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
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appgkeapp" | head -1)
# Replace "gkeapp" with the actual application_name you used

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~gkeapp" \
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

The `Services_GCP` module **must** be deployed and healthy before running this module. It supplies the shared VPC, GKE Autopilot cluster, Cloud SQL instance, Artifact Registry repository, and Filestore NFS server that App_GKE discovers automatically at deploy time.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Variables are configured in the RAD UI form before deploying. The table below lists the most commonly configured variables.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID to deploy into |
| `deployment_id` | _(auto-generated)_ | Short alphanumeric suffix appended to all resource names |
| `region` | `us-central1` | GCP region for resource deployment |
| `tenant_deployment_id` | `demo` | Unique tenant/environment identifier used in resource naming |
| `application_name` | `gkeapp` | Base name for the Kubernetes workload and associated resources |
| `application_version` | `1.0.0` | Container image version tag |
| `container_image_source` | `custom` | `custom` to build via Cloud Build; `prebuilt` to deploy an existing image URI |
| `container_image` | `""` | Full image URI — required when `container_image_source = "prebuilt"` |
| `deploy_application` | `true` | Set to `false` to provision infrastructure only without deploying the workload |
| `min_instance_count` | `1` | Minimum pod replicas (HPA `minReplicas`) |
| `max_instance_count` | `3` | Maximum pod replicas (HPA `maxReplicas`) |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per pod |
| `workload_type` | `Deployment` | `Deployment` for stateless apps; `StatefulSet` for stateful apps. Setting `stateful_pvc_enabled = true` without specifying this variable automatically selects `StatefulSet` |
| `stateful_pvc_enabled` | `null` | Enables a PersistentVolumeClaim template in the StatefulSet spec so each pod replica gets its own isolated PVC. Setting this to `true` without `workload_type` auto-selects `StatefulSet` |
| `stateful_pvc_size` | `null` | Storage size for each PVC (e.g. `"20Gi"`). Only used when `stateful_pvc_enabled = true` |
| `stateful_pvc_mount_path` | `null` | Container path where the PVC is mounted (e.g. `"/var/lib/data"`). Only used when `stateful_pvc_enabled = true` |
| `stateful_pvc_storage_class` | `null` | Kubernetes StorageClass for the PVCs. Leave `null` to use the cluster default; for GKE Autopilot `"standard-rwo"` (Balanced PD, ReadWriteOnce) is the default |
| `service_type` | `LoadBalancer` | `LoadBalancer`, `ClusterIP`, or `NodePort` |
| `gke_cluster_name` | `""` | Target cluster name — leave empty to auto-discover from Services_GCP |
| `database_type` | `POSTGRES` | Cloud SQL engine: `POSTGRES`, `MYSQL`, or `NONE` |
| `application_database_name` | `gkeappdb` | Database name created in Cloud SQL |
| `application_database_user` | `gkeappuser` | Database user name |
| `enable_redis` | `true` | Injects `REDIS_HOST`/`REDIS_PORT` environment variables into pods |
| `enable_nfs` | `true` | Provisions Cloud Filestore NFS and mounts it at `/mnt/nfs` |
| `enable_cloud_armor` | `false` | Attaches a Cloud Armor WAF policy to the GKE Ingress backend |
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication |
| `reserve_static_ip` | `true` | Provisions a global static external IP for the load balancer |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

**Expected resource provisioning times:**

| Resource | Typical duration |
|---|---|
| Kubernetes namespace and RBAC | 1–2 minutes |
| Cloud Build image build (custom mode) | 5–10 minutes |
| Cloud SQL database and user | 2–5 minutes |
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
| `service_url` | Service URL (external URL if LoadBalancer with static IP, otherwise internal) |
| `service_external_ip` | External LoadBalancer IP (if static IP is reserved) |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the database password |
| `storage_buckets` | GCS bucket names created for the application |
| `container_registry` | Artifact Registry repository name |
| `deployment_id` | Unique deployment identifier |
| `resource_prefix` | Resource naming prefix applied to all resources |
| `initialization_jobs` | Names of Kubernetes initialisation jobs |
| `deployment_summary` | Human-readable summary of the full deployment |

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
  -o custom-columns=":metadata.name" | grep "^appgkeapp" | head -1)
# Replace "gkeapp" with the actual application_name you configured

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~gkeapp" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Step 2.1 — Retrieve Cluster Credentials

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list \
    --project=${PROJECT} \
    --format='value(name)' \
    --limit=1) \
  --region=${REGION} \
  --project=${PROJECT}
```

Verify the context is active:

```bash
kubectl config current-context
```

**Expected result:** A context line referencing your project and cluster, e.g. `gke_my-gcp-project_us-central1_gke-cluster-1`.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
>   | jq '.clusters[] | {name, status, endpoint}'
> ```

### Step 2.2 — Identify the Namespace

The namespace follows the pattern `app<application_name><tenant_deployment_id><deployment_id>`:

```bash
kubectl get namespaces | grep gkeapp
```

Set the variable:

```bash
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appgkeapp" | head -1)
echo "Namespace: ${NAMESPACE}"
```

### Step 2.3 — Verify Pods Are Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more pods with status `Running`:

```
NAME                       READY   STATUS    RESTARTS   AGE
gkeapp-7d9f8b6c4-xq2pj    2/2     Running   0          5m
```

The `2/2` indicates the application container and the Cloud SQL Auth Proxy sidecar are both running.

### Step 2.4 — Check the Service External IP

```bash
kubectl get service -n ${NAMESPACE}
```

**Expected result:** A `LoadBalancer` service with an `EXTERNAL-IP` assigned:

```
NAME      TYPE           CLUSTER-IP     EXTERNAL-IP     PORT(S)        AGE
gkeapp    LoadBalancer   10.96.100.50   34.123.45.67    80:31234/TCP   5m
```

Record the external IP — this is your application URL.

> **gcloud equivalent:**
> ```bash
> gcloud compute forwarding-rules list --project=${PROJECT} --filter="region:${REGION}"
> ```

---

## Phase 3 — Access the Application [MANUAL]

### Step 3.1 — Open the Application URL

```bash
export APP_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Application URL: http://${APP_IP}"
```

Open `http://<EXTERNAL-IP>` in your browser.

**Expected result:** The deployed container responds over HTTP/HTTPS.

### Step 3.2 — Retrieve Credentials from Secret Manager

List secrets created for this deployment:

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~gkeapp" \
  --format="table(name)"
```

Access the database password secret:

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
>   | jq -r '.payload.data' | base64 --decode
> ```

---

## Phase 4 — Database and Migrations [MANUAL]

### Step 4.1 — Inspect the Cloud SQL Instance

```bash
gcloud sql instances list --project=${PROJECT}
```

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
>   | jq '.items[] | {name, state, databaseVersion, region}'
> ```

### Step 4.2 — Verify Initialisation Job Completed

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** The `db-init` job (if enabled) shows `COMPLETIONS: 1/1`:

```
NAME      COMPLETIONS   DURATION   AGE
db-init   1/1           45s        10m
```

View init job logs:

```bash
kubectl logs job/db-init -n ${NAMESPACE}
```

### Step 4.3 — List Databases in Cloud SQL

```bash
gcloud sql databases list \
  --instance=$(gcloud sql instances list --project=${PROJECT} --format='value(name)' --limit=1) \
  --project=${PROJECT}
```

**Expected result:** Your application database appears in the list.

---

## Phase 5 — Inspect Storage [MANUAL]

### Step 5.1 — Explore the GCS Bucket

```bash
gcloud storage ls --project=${PROJECT} | grep gkeapp
```

List bucket contents:

```bash
gcloud storage ls gs://<bucket-name>/
```

### Step 5.2 — Verify GCS Fuse Mount (if configured)

```bash
POD=$(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n ${NAMESPACE} ${POD} -- df -h | grep fuse
```

**Expected result:** A fuse filesystem entry appears, mounted at the configured GCS volume path.

### Step 5.3 — Check the NFS Mount (if configured)

```bash
kubectl exec -n ${NAMESPACE} ${POD} -- df -h /mnt/nfs
```

**Expected result:** An NFS filesystem appears, mounted from the Filestore instance IP.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Logs in the Console

Navigate to **Logging > Logs Explorer** in the Cloud Console.

### Step 6.2 — Query Application Logs

**All application pod logs:**
```
resource.type="k8s_container"
resource.labels.project_id="${PROJECT}"
resource.labels.cluster_name="${CLUSTER}"
resource.labels.namespace_name="${NAMESPACE}"
```

**Error logs only:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
severity>=ERROR
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

Scale up to 3 replicas:

```bash
kubectl scale deployment -n ${NAMESPACE} --all --replicas=3
```

Watch pods come up:

```bash
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** Three pods reach `Running` status within 1–2 minutes.

Scale back down:

```bash
kubectl scale deployment -n ${NAMESPACE} --all --replicas=1
```

### Step 8.2 — Trigger a Rolling Update

To trigger a rolling update, return to the RAD UI, navigate to your deployment, update the `application_version` variable, and click **Update**. Monitor the rollout with:

```bash
kubectl rollout status deployment -n ${NAMESPACE}
```

**Expected result:** Output ending with `successfully rolled out`.

### Step 8.3 — View the HPA

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current and desired replica counts along with CPU utilisation percentages.

---

## Phase 9 — Undeploy [AUTOMATED]

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
| Build and deploy to GKE | 1.2 | Automated |
| Configure kubectl access | 2 | Manual |
| Verify pods and service IP | 2 | Manual |
| Access application and retrieve credentials | 3 | Manual |
| Verify database and initialisation job | 4 | Manual |
| Inspect GCS storage and NFS mount | 5 | Manual |
| Query logs in Cloud Logging | 6 | Manual |
| View GKE metrics and uptime checks | 7 | Manual |
| Scale deployment and trigger rolling update | 8 | Manual |
| Undeploy all module resources | 9 | Automated |
