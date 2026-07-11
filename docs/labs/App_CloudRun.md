---
title: "App CloudRun \u2014 Lab Guide"
description: "Hands-on lab: deploy the App CloudRun application-hosting module in your own Google Cloud project — setup, verification, operations, and teardown."
---

# App CloudRun — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

`App CloudRun` is the **foundation deployment engine** for all Cloud Run application modules in this platform. It provisions a production-ready Cloud Run v2 service for any containerised workload — complete with optional Cloud SQL (PostgreSQL, MySQL, or SQL Server), Cloud Filestore NFS, GCS storage, Secret Manager, Cloud Build CI/CD, Cloud Monitoring, and optional Cloud Armor WAF. Application modules such as `Django_CloudRun` and `Ghost_CloudRun` call this engine internally; you can also deploy it directly for a generic workload. This lab takes you through the full operational lifecycle of the **App CloudRun** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on the workload running inside the container. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

> **This lab deploys onto a `Services_GCP` foundation.** Use the **same `tenant_deployment_id`** as your `Services_GCP` deployment so `App CloudRun` auto-discovers and binds to the shared VPC, Cloud SQL instance, NFS server, and Artifact Registry instead of provisioning its own inline copies. (Standalone deployment — with `require_services_gcp_module = false` — is supported, but the point of this lab is to exercise the foundation.)

> **Inputs are validated at plan time.** The module rejects invalid values and invalid feature combinations — a read-replica with no primary, IAP with no authorized users, a `gen1` runtime with NFS, a `mount_nfs` job with `enable_nfs = false`, a `prebuilt` image source with no image — *before* anything is created, with a clear error naming the variable. You will see a fast, explicit failure rather than a half-built deployment. The [Configuration Guide's *Configuration Pitfalls*](https://docs.radmodules.dev/docs/modules/App_CloudRun) table marks which combinations are caught this way.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets, jobs, and storage.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

### Step 1.0 — Choose your lab configuration

Pick a path based on how much of the module you want to exercise. Both bind to your `Services_GCP` foundation via a matching `tenant_deployment_id`.

**Path A — Minimal (fastest).** Defaults: a Cloud Run service backed by PostgreSQL (the shared Cloud SQL), the shared NFS, and an init job. Set only `project_id` and `tenant_deployment_id`. Enough to walk Tasks 2–6.

**Path B — Full-Feature (recommended for this lab).** Exercises the breadth of the engine so every verification step has something to confirm. Suggested inputs (everything else default):

```hcl
project_id           = "<your-project-id>"
tenant_deployment_id = "demo"          # MUST match your Services_GCP deployment

application_name     = "labapp"
application_version  = "1.0.0"

# Database — uses the shared Cloud SQL from Services_GCP (no per-deploy instance)
database_type        = "POSTGRES"
enable_cloudsql_volume = true

# Shared storage & cache (auto-discovered from Services_GCP)
enable_nfs           = true
enable_redis         = true            # falls back to the NFS/Memorystore host
create_cloud_storage = true
storage_buckets      = [{ name_suffix = "data" }]
gcs_volumes          = [{ name = "data", mount_path = "/mnt/data" }]   # GCS Fuse (gen2)

# Runtime
execution_environment = "gen2"         # required for NFS + GCS Fuse
min_instance_count   = 0               # scale-to-zero for a lab
max_instance_count   = 2

# Observability
uptime_check_config  = { enabled = true, path = "/healthz" }

# Access control (safe): IAP requires at least one authorized identity — enforced
enable_iap           = true
iap_authorized_users = ["user:<your-email>"]
```

> **Optional advanced add-on — custom domain + WAF.** Setting `enable_cloud_armor = true` provisions a Global HTTPS Load Balancer with a Cloud Armor policy and *requires* at least one `application_domains` entry (enforced at plan time) plus a post-deploy DNS A-record and ~10–60 min for the managed SSL certificate. It also adds load-balancer cost. Enable it only if you want to exercise the edge path; otherwise leave it off and access the service on its `*.run.app` URL (or via IAP).

> Path B leaves IAP populated (no lockout) and keeps Binary Authorization / VPC-SC in their safe defaults. The deploy steps below assume Path B and tag feature-specific verifications so Path A users can skip them.

### Step 1.1 — Deploy

1. Click **Deploy** in the RAD platform top navigation, open **App (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id` and `tenant_deployment_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, an optional Cloud SQL database
   with its Secret Manager secrets, optional NFS/Redis/GCS storage, builds or
   mirrors the container image, and runs any configured initialisation jobs. First
   deploys take roughly **20–35 minutes** when Cloud SQL creation is included.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~crapp" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

Confirm each capability you enabled actually came up. Steps tagged with a flag apply only to Path B (or whichever features you turned on).

1. **Service health.** With IAP enabled the `*.run.app` URL returns 403 to unauthenticated callers (that is correct — see step 7); without IAP:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"   # expect 200 (or 403 if IAP is on)
   ```

2. **Database** `[database_type != NONE]` — confirm the per-app database and user were created inside the shared Cloud SQL instance, and the password secret exists:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~labapp" --format="value(name)"
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~db-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"   # the generated password
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="table(name)"
   ```

3. **Bound to the foundation** — confirm the service joined the *shared* VPC (not an inline one) and references the shared Cloud SQL via the Auth Proxy volume:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.metadata.annotations)" | grep -E "cloudsql-instances|vpc-access"
   ```

4. **NFS mount** `[enable_nfs = true]` — confirm the NFS volume is mounted into the revision:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.volumes)" | grep -iE "nfs|server"
   ```

5. **GCS Fuse + bucket** `[gcs_volumes / storage_buckets]` — confirm the bucket exists and the Fuse volume is mounted:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~labapp" --format="value(name)"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.volumes)" | grep -i "gcs\|bucket"
   ```

6. **Redis wiring** `[enable_redis = true]` — confirm `REDIS_HOST` / `REDIS_PORT` were injected:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json(spec.template.spec.containers[0].env)" | grep -i redis
   ```

7. **Initialization job** — confirm the init job (e.g. `db-init`) executed successfully during deploy:

   ```bash
   JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~init" --format="value(metadata.name)" --limit=1)
   gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION" \
     --format="table(metadata.name, status.succeededCount, status.failedCount)"
   ```

8. **IAP access control** `[enable_iap = true]` — an unauthenticated request is blocked, an authorized one (with an identity token) succeeds:

   ```bash
   curl -s -o /dev/null -w "anonymous: %{http_code}\n" "$SERVICE_URL/"                                   # expect 403
   curl -s -o /dev/null -w "authed:    %{http_code}\n" -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/"   # expect 200 if your email is authorized
   ```

9. **Uptime check** — confirm the module provisioned a Cloud Monitoring uptime check:

   ```bash
   gcloud monitoring uptime list-configs --project="$PROJECT" --format="table(displayName,monitoredResource.labels.host)" 2>/dev/null | grep -i labapp || echo "(check Monitoring → Uptime checks in the console)"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds or is mirrored and a new revision rolls out.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~crapp"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~crapp"
   ```

5. **Open a database session** for inspection or maintenance (when a database is
   provisioned):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check**; confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with the workload deployed inside
the container.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists and is accessible to the service account, and any
  initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="<job-name>" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build or mirror failed:** review Cloud Build history for the failed build's
  log under Cloud Build → History.
- **403 / permission errors:** verify the runtime service account's IAM roles and
  that all referenced secrets exist in Secret Manager.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
optional Cloud SQL database, Secret Manager secrets, GCS buckets, Cloud Run Jobs,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Choose config & deploy | Automated | Pick Minimal or Full-Feature; module binds to the `Services_GCP` foundation and provisions Cloud Run, the shared Cloud SQL database, secrets, NFS/GCS/Redis wiring, and runs init jobs |
| 2 — Access & verify | Manual | Confirm health, DB + secret, foundation binding, NFS mount, GCS Fuse + bucket, Redis env, init-job success, IAP enforcement, and the uptime check |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; `Services_GCP`-owned shared resources remain |
