---
title: "Homebox on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Homebox on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Homebox on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Homebox_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Homebox is an open-source, self-hosted home inventory and organization
system — track items, attach photos, and organize by location. This lab
takes you through the full operational lifecycle of the **Homebox on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Homebox product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Homebox_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and register the first (admin) account.
- Perform day-2 operations — inspect, scale, update, and manage backups.
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

1. In the RAD platform, open **Homebox (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Homebox_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager password secret, the
   `HBOX_AUTH_API_KEY_PEPPER` secret, a `data` GCS bucket, and runs a
   one-shot database-initialisation job. First deploys take roughly
   **15–25 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~homebox" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving:

   ```bash
   curl -s "$SERVICE_URL/api/v1/status" -o /dev/null -w '%{http_code}\n'   # expect 200
   ```

2. Homebox has **no seeded default admin account** — it uses open
   self-registration. The first person to submit the "Register" form on the
   fresh instance becomes the admin. There is no credential to retrieve.

3. Open `$SERVICE_URL` in a browser and click **Register**. Create the first
   account — it automatically becomes the admin. Then add a test item (with
   a location) to confirm the database write path. Once you've confirmed the
   admin account exists, consider setting
   `HBOX_OPTIONS_ALLOW_REGISTRATION=false` via the RAD platform's **Update**
   flow to close public signups.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — Homebox has no cross-instance coordination
   concern (no cache, no queue), so raising `max_instance_count` is safe.

3. **Update the application version tag** via the RAD platform's **Update**
   flow — Homebox publishes a genuine `latest` tag, or pin an explicit version
   (e.g. `v0.15.0`).

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homebox"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=homebox --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, latency, instance count, and CPU/memory utilisation. The
   module can provision an **uptime check** (disabled by default); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs. The startup probe targets `/api/v1/status`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the initialisation job
  completed. Since Homebox reads discrete `HBOX_DATABASE_*` vars, check the
  container logs for which host/port it resolved.
- **Initialisation job failed:**
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" --project="$PROJECT" --region="$REGION"
  ```
- **Someone else registered first / can't create the admin account:**
  Homebox's open self-registration means whoever submits the "Register" form
  first on a reachable instance becomes the admin. If this happens
  unexpectedly, use Homebox's own account-recovery flow, or redeploy onto a
  fresh database if the instance was never meant to be public.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use
**Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. This removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, the GCS
bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, a GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; register the first (admin) account and add a test item |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, and registration issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
