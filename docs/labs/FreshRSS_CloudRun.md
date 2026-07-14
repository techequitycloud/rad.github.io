---
title: "FreshRSS on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy FreshRSS on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# FreshRSS on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

FreshRSS is a free, self-hosted RSS and Atom feed aggregator — a lightweight,
multi-user "news reader" written in PHP that exposes the Google Reader and Fever
APIs for mobile clients. This lab takes you through the full operational lifecycle
of the **FreshRSS on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on FreshRSS product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the first-boot install and admin login.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  NFS server, Artifact Registry, and shared service accounts this module depends
  on).
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

1. In the RAD platform, open **FreshRSS (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service (PHP/Apache on port 80), a Cloud
   SQL (PostgreSQL 15) database and user with the `FRESHRSS_ADMIN_PASSWORD` and
   database-password secrets in Secret Manager, an NFS volume mounted at
   `/var/www/FreshRSS/data` (no GCS bucket is created), builds the custom container
   image, and runs a one-shot `db-init` job. First deploys take roughly **15–25
   minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~freshrss" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. FreshRSS serves an unauthenticated `/status`
   JSON endpoint that responds once the server is up:

   ```bash
   curl -s "$SERVICE_URL/status"   # expect a JSON status response
   ```

2. Retrieve the auto-generated admin password from Secret Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freshrss AND name~ADMIN_PASSWORD" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in with username `admin` and the
   password from step 2. On first request the container's entrypoint runs
   FreshRSS's own installer (`do-install.php` + `create-user.php`), so allow a
   generous first-boot window before the login page settles — this is idempotent
   and only runs once. After logging in, **change the admin password in the
   FreshRSS UI** — rotating the Secret Manager value alone does not re-set an
   already-installed account.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). By default `min_instance_count = 0` (scale-to-zero) and
   `max_instance_count = 1`. The in-container feed-refresh cron (`CRON_MIN = */15`)
   only fires while an instance is alive, so if you need feeds to refresh on a
   fixed schedule rather than on next request, set `min_instance_count = 1`. Keep
   `max_instance_count` at `1` — a single instance owns the refresh cron and the
   file-based session/cache state on the NFS volume.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. `application_version = "latest"` is pinned to a known-good tag at
   build time — pin it explicitly for production.

4. **Manage secrets and the database:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~freshrss"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init (and import job, if enabled)
   gcloud sql backups list --instance=<instance-name> --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=freshrss --database=freshrss --project="$PROJECT"
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
   CPU / memory utilisation. `uptime_check_config` is disabled by default — enable
   it and review Monitoring → Uptime checks and Alerting → Policies if you want
   automated availability alerts.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with FreshRSS releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe is a TCP check on port 80; the
  liveness probe is an HTTP GET on `/` — a slow first-boot install (schema
  creation) can exhaust a too-tight threshold.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, `enable_cloudsql_volume = true` (Auth Proxy socket),
  and the `db-init` job completed successfully.
- **`db-init` job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Config/state resets on every cold start:** confirm `enable_nfs = true` and
  `nfs_mount_path = /var/www/FreshRSS/data`; without the NFS volume, `config.php`
  and per-user state live on ephemeral disk and are lost on every cold start.
- **Feeds not refreshing:** the in-container cron only runs while an instance is
  alive — with `min_instance_count = 0` refreshes pause until the next request
  wakes the service. Set `min_instance_count = 1` for a reliably ticking refresh.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rules around `enable_nfs`,
`database_type`, and immutable `db_name`/`db_user`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database and user, Secret Manager secrets, and the NFS-backed data
directory contents. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL
instance, shared NFS server, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, NFS volume, and runs `db-init` |
| 2 — Access & verify | Manual | `/status` responds; log in as `admin` with the generated password and change it |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/DB, refresh-cron tuning |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, `db-init`, NFS, and refresh-cron issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
