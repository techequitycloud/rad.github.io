---
title: "Firefly III on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Firefly III on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Firefly III on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Firefly III is a free, open-source self-hosted personal-finance manager for tracking
accounts, transactions, budgets, bills, and recurring transactions. This lab takes you
through the full operational lifecycle of the **Firefly III on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Firefly III product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and create the first admin account.
- Perform day-2 operations — inspect, scale, update, manage secrets and backups, and wire the cron endpoint.
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

1. In the RAD platform, open **Firefly III (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (the Laravel `APP_KEY`, the `STATIC_CRON_TOKEN`, and
   the database password), a Cloud Storage uploads bucket, an NFS/Filestore volume for
   attachments, and runs a one-shot `db-init` job (create role + database). First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates). The schema
   itself is created on the container's first boot, not by a separate migrate job.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~fireflyiii" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Firefly III exposes an unauthenticated `/health`
   endpoint that returns 200 once the app is up and connected to PostgreSQL:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Firefly III shows the **`/register`**
   page. Fill in your email and a password and submit — the **first account created
   becomes the site owner/administrator**; no pre-seeded admin credential exists in
   Secret Manager. After creating it, open **Administration → Settings** and disable
   further registration to prevent unauthorised account creation.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted on
   the next apply). Set `min_instance_count = 1` if you want to avoid cold starts.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new revision rolls out and the image self-migrates
   the schema on boot.

4. **Wire the cron endpoint** so recurring transactions, bill reminders, and
   auto-budgets fire. Read the token and trigger it manually to verify, then create a
   daily Cloud Scheduler job (or use the `cron_jobs` input):

   ```bash
   CRON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~cron-token" --format="value(name)" --limit=1)
   TOKEN=$(gcloud secrets versions access latest --secret="$CRON_SECRET" --project="$PROJECT")
   curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
   ```

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~fireflyiii"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=fireflyiii --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU /
   memory utilisation. If you enabled `uptime_check_config`, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Firefly III releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup probe
  is TCP on port 8080 and allows a generous first-boot window while migrations run.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret exists, and the `db-init` job completed. On Cloud Run the connection
  is private-IP TCP with `PGSQL_SSL_MODE = require` — a plaintext/`disable` mode fails.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Recurring transactions not firing:** verify a daily Cloud Scheduler job hits
  `/api/v1/cron/<STATIC_CRON_TOKEN>` — Firefly does no scheduling on its own.
- **Uploaded attachments disappearing:** confirm `enable_nfs = true` and the NFS volume
  is mounted at `/var/lib/fireflyiii`; without it, files land on ephemeral disk.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, NFS volume, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, uploads bucket, NFS, and runs DB init |
| 2 — Access & verify | Manual | `/health` returns 200; create the owner account at `/register` |
| 3 — Operate | Manual | Inspect revisions, scale, update version, wire cron, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, cron, NFS, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
