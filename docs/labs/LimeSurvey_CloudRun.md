---
title: "LimeSurvey on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy LimeSurvey on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LimeSurvey on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

LimeSurvey is a free, open-source (GPL) online survey and questionnaire platform
written in PHP, supporting unlimited surveys, conditional branching, quotas, and
multi-language questionnaires. This lab takes you through the full operational
lifecycle of the **LimeSurvey on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on LimeSurvey survey-authoring features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the first-run super-admin login.
- Perform day-2 operations — inspect, scale, update, and manage secrets and uploads.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore/NFS, Artifact Registry, and shared service accounts this module
  depends on).
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

1. In the RAD platform, open **LimeSurvey (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager secrets (`ADMIN_PASSWORD` and the database password), a
   Cloud Filestore (NFS) instance for the upload directory, a dedicated
   `limesurvey-uploads` Cloud Storage bucket, builds the container image, and runs
   a one-shot `db-init` job that creates the empty database and user. LimeSurvey's
   own console installer then builds the schema on first container start. First
   deploys take roughly **20–35 minutes** (Cloud SQL and Filestore creation
   dominate), plus a few extra minutes on the very first boot for the schema
   install.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~limesurvey" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. LimeSurvey's liveness probe is an unauthenticated
   `GET /` on the landing page — allow generous time on the very first request while
   the console installer finishes building the schema:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Retrieve the auto-generated super-admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" \
       --filter='name~admin-password' --format='value(name)' | head -1)" \
     --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and sign in to the admin panel (`/admin`) as
   `admin` / `admin@techequity.cloud` using the password retrieved above. Create a
   test survey to confirm the database and upload paths both work end to end.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1` unless shared NFS + session handling for multiple
   instances has been confirmed — LimeSurvey keeps PHP session state.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   `latest` resolves to the pinned `6-apache` tag — pin it explicitly in production
   to avoid an unplanned schema upgrade.

4. **Manage secrets, uploads, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~limesurvey"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"        # db-init job
   gcloud storage ls "gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter='name~limesurvey-uploads' --format='value(name)' | head -1)"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=limesurvey --project="$PROJECT"
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
   CPU / memory utilisation. Also check the Filestore instance's capacity and
   throughput metrics, since survey uploads accumulate there. The module also
   provisions an **uptime check**; confirm it is green under Monitoring → Uptime
   checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LimeSurvey releases.

- **Every page 500s with "table settings_global not found":** the console
  installer's schema creation silently failed — almost always a storage-engine
  problem (the image defaults to MyISAM, which Cloud SQL disables; this module
  forces `InnoDB`) or the installer could not reach the database. Check the
  container logs from the very first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200
  ```
- **Service exits immediately on boot:** `ADMIN_PASSWORD` is required — the
  container exits 1 without it. Confirm the secret exists and resolved into the
  revision.
- **`db-init` job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Uploaded assets vanish after a restart:** confirm `enable_nfs = true` and that
  the Filestore instance is reachable — without NFS, `/var/www/html/upload` is
  ephemeral.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and, since this module connects over private-IP TCP by default
  (`enable_cloudsql_volume = false`), that the service has VPC egress to reach it.
- **Image build failed:** review Cloud Build history for the failed build's log.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to never revert the forced `InnoDB` engine,
and to never rename `db_name`/`db_user` after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Cloud Filestore instance, Secret Manager secrets, GCS buckets,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), Filestore (NFS), storage bucket, secrets, and runs db-init |
| 2 — Access & verify | Manual | Health check passes; retrieve admin password; log in and create a test survey |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/uploads, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose schema-install, boot, init-job, NFS, and database issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
