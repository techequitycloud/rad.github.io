---
title: "Paperless-ngx on Cloud Run \u2014 Lab Guide"
---

# Paperless-ngx on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Paperless_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Paperless-ngx is an open-source document management system that transforms scanned
documents into a searchable digital archive using OCR (Tesseract), machine-learning
classification, and full-text search. This lab takes you through the full operational
lifecycle of the **Paperless-ngx on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Paperless-ngx product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Paperless_CloudRun) —
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
  Redis/NFS, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Paperless-ngx (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Paperless_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions two Cloud Run services (a web service and a background
   worker/consumer service), a Cloud SQL (PostgreSQL) database with its Secret Manager
   secrets, a GCS Fuse media bucket, Redis connectivity, builds the container image,
   and runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~paperless AND NOT metadata.name~worker" \
     --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   WORKER_SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~paperless AND metadata.name~worker" \
     --format="value(metadata.name)" --limit=1)
   echo "Web service: $SERVICE"
   echo "URL:         $SERVICE_URL"
   echo "Worker:      $WORKER_SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the web service is healthy and connected to its database:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL"   # expect 200
   ```

2. Confirm both Cloud Run services are ready:

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~paperless"
   ```

3. Retrieve the admin password from Secret Manager and sign in at `$SERVICE_URL`:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~paperless-admin" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Sign in with the username set by `admin_user` (default: `admin`) and the password
   retrieved above. Paperless-ngx's own documentation covers its product features.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the services and their revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run services describe "$WORKER_SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out on both services.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~paperless"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=paperless --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$WORKER_SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter for the web service:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   Logs Explorer filter for the worker service:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<worker-service>"`.

2. **Monitoring** — open the Cloud Run dashboard for each service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check**; confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Paperless-ngx releases.

- **Web service revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors. The health probe targets `/` (port 8000); a failed
  probe means the gunicorn server or database connection did not come up in time.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Worker service not processing documents:** inspect the worker service revisions
  and its logs for Celery or Redis connection errors.
  ```bash
  gcloud run services logs read "$WORKER_SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the database-initialisation job completed.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — both Cloud Run services,
Cloud SQL database, Secret Manager secrets, GCS buckets (including the media bucket),
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, Redis/NFS, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run web + worker services, Cloud SQL, GCS media bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Both services healthy; admin credential retrieved; sign in confirmed |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging for both services; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose web/worker revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
