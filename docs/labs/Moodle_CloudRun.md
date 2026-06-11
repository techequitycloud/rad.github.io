---
title: "Moodle on Cloud Run \u2014 Lab Guide"
---

# Moodle on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Moodle is an open-source Learning Management System (LMS) used by universities,
schools, and online training providers worldwide. This lab takes you through the full
operational lifecycle of the **Moodle on Cloud Run** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Moodle product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets, cron, and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore NFS, Redis, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **Moodle (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets, a Filestore NFS share for
   `moodledata`, optional Redis, builds the container image, runs the `db-init`
   and `nfs-init` one-shot jobs, and provisions a Cloud Scheduler cron job. First
   deploys take roughly **25–45 minutes** (Cloud SQL and Filestore creation
   dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~moodle" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and its PHP runtime is operational:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/health.php"
   # expect 200
   ```

   > On first boot, Moodle installs its database schema before the startup probe
   > passes. If you see a non-200 code, wait 1–2 minutes and retry.

2. Retrieve the database password from Secret Manager and note the Moodle cron
   and SMTP password secrets that were auto-generated:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~moodle"
   ```

   The database password secret name is reported in the deployment outputs. To
   read it:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~moodle" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Open `${SERVICE_URL}` in a browser and sign in to the Moodle admin panel. The
   initial admin credentials are set during the `db-init` job (username and email
   are configurable via `environment_variables` at deploy time).

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

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets, Cloud Scheduler cron, and backup jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~moodle"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
     --filter="name~moodle"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

   To manually trigger the Moodle cron job:

   ```bash
   CRON_JOB=$(gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
     --filter="name~moodle" --format="value(name)" --limit=1)
   gcloud scheduler jobs run "$CRON_JOB" --location="$REGION" --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=moodle --database=moodle --project="$PROJECT"
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
   / memory utilisation. The module also provisions an **uptime check**; confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Moodle releases.

- **Revision unhealthy / service won't serve:** the startup probe targets
  `/health.php`; Moodle allows up to 10 minutes for first-boot schema creation.
  Inspect the latest revision and its logs for startup errors, and confirm env
  vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, the `db-init` job completed successfully, and the
  Cloud SQL Auth Proxy sidecar is present in the revision configuration.
- **Initialisation jobs failed (`db-init` or `nfs-init`):** list executions and
  read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-nfs-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Moodle cron not running:** confirm the Cloud Scheduler job is enabled and
  its last run succeeded; check the cron password secret exists.
  ```bash
  gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
    --filter="name~moodle"
  ```
- **NFS / `moodledata` errors:** confirm the Filestore instance is `READY`; the
  `nfs-init` job must have completed to set correct `www-data` ownership on the
  share directories. The service requires `execution_environment = "gen2"` for NFS
  volume mounts.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Filestore NFS share, Cloud Scheduler cron job, Secret Manager
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), Filestore NFS, Redis, Cloud Scheduler cron, secrets, and runs db-init + nfs-init jobs |
| 2 — Access & verify | Manual | Health check at `/health.php` passes; sign in to the Moodle admin panel |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/cron/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, NFS, cron, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
