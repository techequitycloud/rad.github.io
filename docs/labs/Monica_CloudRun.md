---
title: "Monica on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Monica on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Monica on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Monica is an open-source personal relationship management (PRM) application — a
"personal CRM" for organising how you stay in touch with friends, family, and
contacts. This lab takes you through the full operational lifecycle of the
**Monica on Cloud Run** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Monica product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
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

1. In the RAD platform, open **Monica (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager secrets (the Laravel `APP_KEY` and the
   database password), a Cloud Storage `monica-uploads` bucket, an NFS volume for
   Laravel's `storage/` directory, builds nothing (the image is the official
   prebuilt `monica:<version>`), and runs a one-shot database-initialisation job.
   First deploys take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~monica" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. The startup probe is TCP on `/` (passes as soon as
   Apache binds the port); the liveness probe is HTTP `GET /`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

   Allow a generous window on first request after a cold start — Apache boot plus
   the entrypoint's `php artisan migrate --force` both run before the page serves.

2. Open `$SERVICE_URL` in a browser. Monica has **no default credentials** — an
   unauthenticated visitor is redirected to the registration/setup page. Register
   the first account (use `admin@techequity.cloud` for RAD deployments); it
   becomes the administrator. No further action is needed to disable open
   sign-up — verify this behaviour matches your intended access model before
   sharing the URL.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). `min_instance_count = 0` (the default) scales to
   zero between requests; set it to `1` to avoid cold-start + migration latency on
   a personal CRM you check often.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new revision rolls out pulling the
   new `monica:<version>` tag, and the entrypoint's `php artisan migrate --force`
   upgrades the schema automatically on the next boot.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~monica"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   Never rotate the `APP_KEY` secret after first boot — it is a Laravel
   encryption key, and rotating it permanently corrupts every encrypted database
   field and invalidates all sessions.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=monica --project="$PROJECT"
   ```

6. **Inspect uploaded files** (contact photos/documents live under Laravel's
   `storage/`, persisted via NFS by default and mirrored to the `monica-uploads`
   bucket):

   ```bash
   gcloud storage ls gs://<uploads-bucket>/
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
   CPU / memory utilisation. The module also provisions an **uptime check**; confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Monica releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is TCP on `/` (passes as soon as Apache binds the port); the liveness
  probe is HTTP `GET /` with a generous delay for first-boot migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed successfully. Monica
  connects over the instance private IP by default (`enable_cloudsql_volume = false`) —
  no Auth Proxy socket, no SSL required.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Uploaded files missing after a cold start:** confirm `enable_nfs = true` —
  disabling NFS risks losing files written to Laravel's `storage/` directory
  between cold starts.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot,
and the immutability of `db_name`/`db_user` once set).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), secrets, storage bucket, NFS, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access, inspect uploads |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, and NFS/persistence issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
