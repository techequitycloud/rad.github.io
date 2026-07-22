---
title: "Kimai on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Kimai on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Kimai on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Kimai is a free, open-source time-tracking application used by freelancers
and agencies for billable-hours tracking, timesheets, and reporting that
feeds into invoicing. This lab takes you through the full operational
lifecycle of the **Kimai on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Kimai product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Access and verify the running service, and log in with the bootstrapped
  administrator account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and
  backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud
  SQL, Artifact Registry, and shared service accounts this module depends
  on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the
  project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Kimai (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager secrets (`APP_SECRET`, `ADMINPASS`, and
   the database password), the `storage` Cloud Storage bucket, builds the
   custom `DATABASE_URL`-composing wrapper image, and runs the `db-init`
   initialization job (creates the database, user, and grants). First
   deploys take roughly **15–25 minutes** (Cloud SQL creation and the image
   build dominate).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~kimai" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy — Kimai's login page returns **HTTP 200**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/en/login"   # expect 200
   ```

2. Retrieve the bootstrapped administrator credentials from Secret Manager —
   the username is always `admin` (hardcoded by the vendor image), and the
   password is the auto-generated `ADMINPASS` secret:

   ```bash
   ADMINPASS_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in with `admin` and the password
   retrieved above.

4. Create a test project, activity, and timesheet entry to confirm
   end-to-end write/read against the real database: **Administration →
   Projects** (create one), **Administration → Activities** (create one),
   then log a timesheet entry against them from the main timesheet view.
   Reload the page — or redeploy — and confirm the entry is still there.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an
   immutable revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the service spec, so
   scaling is a configuration change, not a manual `gcloud` edit (a manual
   edit would be reverted on the next apply).

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds
   `FROM kimai/kimai2:<version>-apache` and a new revision rolls out.
   `kimai:install` re-runs safely against the existing schema on the new
   container's first boot — no manual migration step is needed.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~kimai"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=kimai --project="$PROJECT"
   ```

6. **Set up an API token or additional users.** With the admin account
   logged in, go to **Profile → API access** to generate an API token for
   time-tracking integrations, or **Administration → Users** to invite
   teammates (self-service registration is off by default).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and
   CPU / memory utilisation. The module can provision an **uptime check**
   (`uptime_check_config.enabled = true`); if enabled, confirm it is green
   under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Kimai releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets
  resolved. The startup probe targets `GET /en/login` with a generous
  20-retry threshold to cover the first-boot `kimai:install` run.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors on first boot.** Confirm the `db-init` job
  completed successfully before the app's own `kimai:install` (which runs on
  every container start) had a chance to run:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
  If the app container is failing to start with a database error, verify
  `DB_IP` resolved correctly — it should be the Cloud SQL instance's private
  IP on Cloud Run (this module does not use the Auth Proxy socket).
- **Wrong port assumption.** If you're comparing this deployment against
  documentation or another Kimai install that assumes port 80, note this
  module's `:apache` image variant serves on **8001** — confirmed via local
  testing and live deployment. `container_port` should read `8001`.
- **Image build failed:** review Cloud Build history for the failed build's
  log — the build compiles the thin wrapper image `FROM kimai/kimai2`.
- **403 / permission errors:** verify the runtime service account's IAM
  roles.
- **Forgot the admin password:** it's not lost — `ADMINPASS` is a persistent
  Secret Manager secret, re-injected and re-applied to the `admin` account
  on every container boot (idempotent, so re-fetching the secret and
  restarting the service, if needed, always yields a working login):
  ```bash
  gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
  ```

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS
buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs the `db-init` job |
| 2 — Access & verify | Manual | Health check returns 200 at `/en/login`; log in as `admin` with the generated `ADMINPASS` secret; create a test timesheet entry |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access, API/user setup |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, port, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
