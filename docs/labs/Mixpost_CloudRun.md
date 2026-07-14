---
title: "Mixpost on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Mixpost on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Mixpost on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Mixpost is an open-source, self-hosted social media scheduling and management
platform — a Buffer/Hootsuite alternative for composing, scheduling, publishing,
and analysing posts across multiple social accounts from one dashboard. This lab
takes you through the full operational lifecycle of the **Mixpost on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Mixpost product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Understand the cold-start trade-off for scheduled post publishing and how to
  restore continuous operation.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  NFS/Redis host, Artifact Registry, and shared service accounts this module
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

1. In the RAD platform, open **Mixpost (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (the prebuilt `inovector/mixpost`
   image — no custom build), a Cloud SQL (MySQL 8.0) database with its Secret
   Manager secrets (the Laravel `APP_KEY` and the database password), a Cloud
   Storage bucket, mirrors the prebuilt image into Artifact Registry, and runs a
   one-shot `db-init` job that creates the application database and user. First
   deploys take roughly **15–30 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~mixpost" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is reachable. The startup probe is TCP on port 80, and the
   liveness probe is HTTP on `/`, which Mixpost/nginx answers with `200`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser and sign in. Mixpost's admin account is
   **seeded by the image itself** and is not configurable through this module —
   the `mixpost_admin_email` input is declared but not currently injected into
   the running container. Use the image's documented default first-login
   credentials (`admin@example.com` / `changeme`) and **change the password
   immediately** after first login.

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

3. **Understand the scheduled-publishing trade-off.** This module defaults to
   `min_instance_count = 0` and `cpu_always_allocated = false` (cold-start,
   request-based billing). Mixpost's queue worker and Laravel scheduler run
   inside the same container under supervisord, so they only execute while an
   instance happens to be warm or serving a request — **scheduled social posts
   do not reliably publish on their own out of the box**, because Cloud Run does
   not wire up any Cloud Scheduler job automatically. To make scheduled
   publishing reliable, either:
   - point a Cloud Scheduler job at a cron/health endpoint on `$SERVICE_URL`
     every minute to keep an instance warm and trigger `schedule:run` (use the
     generic `cron_jobs` foundation variable or an external scheduler), or
   - set `cpu_always_allocated = true` **and** `min_instance_count >= 1` on the
     module and apply via **Update**, to keep the scheduler running continuously
     (mirrors the repository's always-on convention for background-work apps).

4. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image is pulled and a new revision rolls
   out — there is no separate migration job, since the image runs
   `php artisan migrate --force` on every boot.

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~mixpost"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + any scheduled backup jobs
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=mixpost --project="$PROJECT"
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
   CPU / memory utilisation. The module can provision an **uptime check** (disabled
   by default — `uptime_check_config.enabled = false`); enable it for a
   production deployment and confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Mixpost releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is TCP on port 80 (90s initial delay, high failure threshold for first
  boot); the liveness probe is HTTP on `/`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the `db-init` job completed. This module defaults `enable_cloudsql_volume =
  false` (TCP/private-IP, not the Auth Proxy socket) — if the app cannot reach
  the database, check the deployed revision's env to see whether a socket or TCP
  path is actually in effect.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Scheduled posts not publishing:** this is expected under the cold-start
  default — see Task 3, step 3 for the fix (Cloud Scheduler cron hit, or
  `cpu_always_allocated = true` + `min_instance_count >= 1`).
- **Login credentials unknown / "admin account not configured":** the admin
  account is seeded by the image itself, not by this module's
  `mixpost_admin_email` variable — use the image's documented default credentials.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including the critical rule never to
rotate `APP_KEY` after first boot, and the immutability of
`application_database_name` / `application_database_user`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, NFS/Redis
host, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs `db-init` |
| 2 — Access & verify | Manual | Health check passes; sign in with the image's default admin credentials and change the password |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage the scheduled-publishing trade-off, secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, scheduling, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
