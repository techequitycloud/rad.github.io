---
title: "App GKE \u2014 Lab Guide"
---

# App GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)**

## Overview

**Estimated time:** 45–90 minutes

`App GKE` is the **foundation deployment engine** for all GKE Autopilot application modules in this platform. It provisions a production-ready Kubernetes workload (Deployment or StatefulSet) on GKE Autopilot for any containerised application — complete with optional Cloud SQL (PostgreSQL, MySQL, or SQL Server), Cloud Filestore NFS, GCS storage, Secret Manager via Workload Identity, Cloud Build CI/CD, Cloud Monitoring, and optional Cloud Armor WAF. Application modules such as `Django_GKE` and `Ghost_GKE` call this engine internally; you can also deploy it directly for a generic workload. This lab takes you through the full operational lifecycle of the **App GKE** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on the workload running inside the container. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

> **This lab deploys onto a `Services_GCP` foundation.** Use the **same `tenant_deployment_id`** as your `Services_GCP` deployment so `App GKE` deploys into the shared **GKE Autopilot cluster** and binds to the shared VPC, Cloud SQL instance, NFS server, and Artifact Registry instead of provisioning its own inline cluster and infrastructure. (Standalone — `require_services_gcp_module = false` — creates an inline GKE cluster and takes much longer; the point of this lab is to exercise the foundation.)

> **Inputs are validated at plan time.** The module rejects invalid values and combinations — `stateful_pvc_enabled` with `workload_type = "Deployment"`, IAP with no OAuth client, a `prebuilt` image source with no image, a `mount_nfs` job with `enable_nfs = false`, a bare-integer ResourceQuota memory value — *before* anything is created, with a clear error naming the variable. The [Configuration Guide's *Configuration Pitfalls*](https://docs.radmodules.dev/docs/modules/App_GKE) table marks which combinations are caught this way.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets, jobs, and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

### Step 1.0 — Choose your lab configuration

Pick a path based on how much of the module you want to exercise. Both bind to your `Services_GCP` foundation via a matching `tenant_deployment_id`.

**Path A — Minimal (fastest).** Defaults: a `Deployment` workload backed by PostgreSQL (the shared Cloud SQL), the shared NFS, and an init job. Set only `project_id` and `tenant_deployment_id`. Enough to walk Tasks 2–6.

**Path B — Full-Feature (recommended for this lab).** Exercises the breadth of the engine so every verification step has something to confirm. Suggested inputs (everything else default):

```hcl
project_id           = "<your-project-id>"
tenant_deployment_id = "demo"          # MUST match your Services_GCP deployment

application_name     = "labgke"
application_version  = "1.0.0"

# Database — uses the shared Cloud SQL from Services_GCP (no per-deploy instance)
database_type        = "POSTGRES"
enable_cloudsql_volume = true

# Shared storage & cache (auto-discovered from Services_GCP)
enable_nfs           = true
enable_redis         = true
create_cloud_storage = true
storage_buckets      = [{ name_suffix = "data" }]

# Workload shape & scaling
# (leave stateful_pvc_enabled unset for a stateless Deployment; set it true to
#  exercise a StatefulSet with per-pod PVCs — do NOT also set workload_type)
min_instance_count   = 1
max_instance_count   = 3
enable_pod_disruption_budget = true    # reliability: keep a pod during disruptions

# Observability
uptime_check_config  = { enabled = true, path = "/healthz" }

# Access control (safe): IAP on GKE needs an OAuth client + support email — enforced
enable_iap           = true
iap_oauth_client_id     = "<oauth-client-id>"
iap_oauth_client_secret = "<oauth-client-secret>"
iap_support_email       = "<your-email>"
```

> **Optional advanced add-on — custom domain + WAF/CDN.** `enable_custom_domain = true` (with a domain) provisions a Google-managed certificate via the Gateway; `enable_cloud_armor = true` then needs a custom domain *or* `service_type = "LoadBalancer"` (enforced), and `enable_cdn` requires the custom domain (enforced). These add cost and a post-deploy DNS step — enable only to exercise the edge path.

> Path B keeps IAP populated (no lockout) and leaves Binary Authorization / VPC-SC at safe defaults. The deploy steps below assume Path B and tag feature-specific verifications so Path A users can skip them.

### Step 1.1 — Deploy

1. Click **Deploy** in the RAD platform top navigation, open **App (GKE)** from the **Platform Modules** list to start configuration, set `project_id` and `tenant_deployment_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   an optional Cloud SQL database with its Secret Manager secrets, optional
   NFS/Redis/GCS storage, builds or mirrors the container image, and runs any
   configured initialisation jobs. First deploys take roughly **20–35 minutes**
   when Cloud SQL creation is included.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gkeapp | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

Confirm each capability you enabled actually came up. Steps tagged with a flag apply only to Path B (or whichever features you turned on).

1. **Workload health.** Confirm pods are `Running`/`Ready` and find the external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"   # expect 200 (or 403 if IAP is on)
   ```

2. **Workload shape** — confirm you got a `Deployment` (Path A) or `StatefulSet` (`stateful_pvc_enabled = true`), and the PVCs for a StatefulSet:

   ```bash
   kubectl get deploy,statefulset,pvc -n "$NS"
   ```

3. **Database** `[database_type != NONE]` — confirm the per-app database/user inside the shared Cloud SQL and the password secret materialised into the namespace:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~db-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="table(name)"
   kubectl get secret -n "$NS" | grep -i db        # secret synced into the namespace
   ```

4. **DB / Redis / NFS wiring** — confirm the env and volume mounts the foundation injected into the pod:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep -iE "DB_|REDIS_"   # DB_*/REDIS_* present
   kubectl describe pod "$POD" -n "$NS" | grep -iA2 "Mounts:"   # NFS / GCS / Cloud SQL volume mounts
   ```

5. **Initialization job** — confirm the init job completed:

   ```bash
   kubectl get jobs -n "$NS"
   kubectl get job -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.succeeded}{"\n"}{end}'   # succeeded=1
   ```

6. **IAP access control** `[enable_iap = true]` — an unauthenticated request is blocked; an authorized one succeeds:

   ```bash
   curl -s -o /dev/null -w "anonymous: %{http_code}\n" "http://${EXTERNAL_IP}/"
   curl -s -o /dev/null -w "authed:    %{http_code}\n" -H "Authorization: Bearer $(gcloud auth print-identity-token)" "http://${EXTERNAL_IP}/"
   ```

7. **Uptime check** `[uptime_check_config.enabled]` — confirm the Cloud Monitoring uptime check exists (Monitoring → Uptime checks, or `gcloud monitoring uptime list-configs`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and (if enabled) the horizontal
   autoscaler and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds or is mirrored and a rolling update replaces the
   pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gkeapp"
   kubectl get jobs,cronjobs -n "$NS"          # init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~gkeapp"
   ```

5. **Open a database session** for inspection or maintenance (when a database is
   provisioned):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module also provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with the workload deployed inside
the container.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and any init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image build or mirror failed:** review Cloud Build history for the failed build's
  log under Cloud Build → History.
- **403 / permission errors:** verify the Workload Identity binding and that the
  workload service account has the required Secret Manager and Cloud SQL IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, optional Cloud SQL database, Secret Manager secrets, GCS buckets,
Kubernetes Jobs, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Choose config & deploy | Automated | Pick Minimal or Full-Feature; module deploys into the shared GKE Autopilot cluster, binds to the foundation's Cloud SQL/NFS/registry, provisions secrets/storage, and runs init jobs |
| 2 — Access & verify | Manual | Connect to the cluster; confirm workload health & shape, DB + secret sync, DB/Redis/NFS wiring, init-job success, IAP enforcement, and the uptime check |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/jobs/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, image-pull, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
