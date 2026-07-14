---
title: "Matomo on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Matomo on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Matomo on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Matomo is the leading open-source web analytics platform — a privacy-focused, self-hosted alternative to Google Analytics. This lab takes you through the full operational lifecycle of the **Matomo on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Matomo product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the running service and complete Matomo's first-run web installer.
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

1. Click **Deploy** in the RAD platform top navigation, open **Matomo (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager password secret, a Filestore NFS share that persists
   Matomo's document root (`/var/www/html`), a dedicated `matomo-data` GCS bucket,
   mirrors the official `matomo:5-apache` image into Artifact Registry (no build
   step — this is a prebuilt module), and runs a one-shot `db-init` job that creates
   the empty database and user. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~matomo" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. Matomo's health path is `/`, which returns HTTP 200 —
   or **302 to the installer on a fresh deploy** — once Apache and PHP are running.
   With the default scale-to-zero, allow a 10–30 second cold start on the first
   request:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser. On a fresh deploy Matomo presents its **web
   installer**: the database screen is pre-filled from the injected
   `MATOMO_DATABASE_*` environment variables (the `db-init` job already created the
   empty database and user), so click through, create the **superuser** account, and
   register your first tracked website. The installer writes `config.ini.php` to the
   NFS-persisted document root, so setup survives restarts. If you ever need the
   database password:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~matomo" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. **Immediate hardening:** the installer URL is public until setup completes —
   finish the wizard right after deploying. Then copy the tracking snippet from
   **Administration → Websites → Tracking Code** into a test page and confirm the
   visit appears under **Visitors → Visits Log**.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Note the
   module defaults to `min = 0`, `max = 1`: raise `min` to `1` for an always-warm
   production tracker, and keep `max = 1` unless multi-instance safety over the
   shared NFS document root has been confirmed.

3. **Update the application version** by changing the `application_version` input
   (use an **Apache variant** tag, e.g. `5.x-apache`) via **Update** on the
   deployment details page; the new image is mirrored and a new revision rolls out.
   Matomo runs its own schema migrations from the persistent document root.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~matomo"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~matomo"
   ```

5. **Open a database session** for inspection or maintenance (analytics tables use
   the `matomo_` prefix):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=matomo --project="$PROJECT"
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
   / memory utilisation. The module's **uptime check is disabled by default**
   (`uptime_check_config.enabled = false`) — enable it via **Update** for
   production, then confirm it is green under Monitoring → Uptime checks and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Matomo releases.

- **Revision unhealthy / service won't serve:** the startup probe is TCP with a
  generous 20-failure threshold to cover the first-boot copy of the application
  from `/usr/src/matomo` into the empty NFS volume. Inspect the latest revision and
  its logs before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** Matomo connects over **TCP to the Cloud SQL
  private IP** (`enable_cloudsql_volume = false`; the IP is injected as
  `MATOMO_DATABASE_HOST`). Confirm the MySQL 8.0 instance is `RUNNABLE`, the DB
  password secret exists, and the `db-init` job completed — it verifies the app
  user's credentials, so a green `db-init` rules out most auth issues.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **NFS mount / installer reappears after restart:** verify `enable_nfs = true`,
  `nfs_mount_path = /var/www/html`, and that the execution environment is `gen2`
  (required for Filestore mounts in Cloud Run). If the document root is not
  persisted, `config.ini.php` is lost on every restart and Matomo re-enters setup.
- **Image pull failed:** this is a **prebuilt** module — there is no Cloud Build
  step. Check that the mirrored image exists in Artifact Registry and that
  `application_version` is a real **Apache variant** tag (`5-apache`, `5.x-apache`);
  fpm/alpine tags don't serve HTTP on port 80.
- **Slow pages under heavy traffic (app-specific):** Matomo defaults to
  browser-triggered report archiving, which runs inside visitor requests. For busy
  sites, add a `cron_jobs` entry running `console core:archive` so archiving runs
  as a scheduled Cloud Run Job instead.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets (including the `matomo-data`
bucket), Filestore NFS share, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), NFS, GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; complete Matomo's web installer and verify tracking |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; enable the uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, NFS, image, archiving, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
