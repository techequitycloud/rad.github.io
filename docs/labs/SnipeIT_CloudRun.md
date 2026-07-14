---
title: "SnipeIT on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy SnipeIT on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# SnipeIT on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Snipe-IT is a free, open-source IT asset and inventory management system for
tracking hardware, software licences, accessories, and consumables, with
asset check-in/out, audit logging, depreciation, and a full REST API. This
lab takes you through the full operational lifecycle of the **Snipe-IT on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Snipe-IT product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its first-run `/setup` wizard.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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

1. In the RAD platform, open **Snipe-IT (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service running the official
   `snipe/snipe-it` PHP/Apache image (no custom build), a Cloud SQL for
   MySQL 8.0 database with its Secret Manager secrets (the Laravel `APP_KEY`
   and the database password), a Cloud Filestore (NFS) instance mounted at
   `/var/lib/snipeit` for uploaded asset images/signatures/barcodes, a Cloud
   Storage `snipeit-uploads` bucket, and runs two ordered initialisation jobs
   (`db-init` then `migrate`). First deploys take roughly **20–35 minutes**
   (Cloud SQL and Filestore creation dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~snipeit" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Snipe-IT
   serves its login/setup page at `/` unauthenticated, so a `200` there
   confirms the PHP application and the MySQL connection are both healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On a fresh install, Snipe-IT redirects
   `/` to the **`/setup`** installation wizard rather than offering a
   self-serve sign-up form. Walk through the wizard to create the first
   administrator account. If the redirect loops or lands on the wrong host,
   confirm `APP_URL` matches the deployed service URL (Snipe-IT derives it
   automatically from the predicted Cloud Run URL, but a custom domain or
   load balancer added after deploy needs `APP_URL` updated to match via
   `environment_variables`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would
   be reverted on the next apply). `max_instance_count` defaults to `1` and
   should be left there unless multi-instance behaviour with shared NFS
   storage and Laravel's database-backed session driver has been verified for
   your deployment.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image is pulled and a new
   revision rolls out. Pin `application_version` to a specific `snipe/snipe-it`
   release tag in production rather than tracking `v8-latest`.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~snipeit"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + migrate + any scheduled backup jobs
   ```

   Never rotate the `APP_KEY` secret after first boot — it invalidates every
   active session and any application data Snipe-IT encrypted with the old key.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=snipeit --database=snipeit --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. `uptime_check_config` is **disabled by default**
   for this module — enable it in the deployment inputs if you want a
   provisioned uptime check and check-failure alert under Monitoring →
   Uptime checks / Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Snipe-IT releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe is TCP on the container port (30 s initial delay, ~5-minute
  failure window) to allow first-boot DB setup; the liveness probe is HTTP
  `GET /` (300 s initial delay).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`.
  This module reaches Cloud SQL over **TCP against the private IP** by default
  (`enable_cloudsql_volume = false`), not the Auth Proxy Unix socket used by
  most other Cloud Run modules — confirm the runtime service account has VPC
  egress and the instance's private IP is reachable.
- **Initialisation job failed:** list executions and read the failed one's logs
  for either job in the chain (`db-init` runs first, then `migrate`):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **`/setup` wizard loops or 404s:** almost always an `APP_URL` mismatch —
  confirm the injected `APP_URL` matches the host you're browsing to.
- **Uploads/asset images disappear after a cold start:** confirm
  `enable_nfs = true` and the Filestore instance is reachable; disabling NFS
  makes the `/var/lib/snipeit` upload tree ephemeral per instance.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`APP_KEY` after first boot, and why `db_user_env_var_name` /
`db_name_env_var_name` / `db_password_env_var_name` are inert for this
module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Filestore (NFS) instance, Secret Manager secrets, GCS
buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), NFS, secrets, storage bucket, and runs `db-init` → `migrate` |
| 2 — Access & verify | Manual | Health check passes; complete the `/setup` wizard to create the first administrator account |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, `/setup`, and NFS issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
