---
title: "Focalboard on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Focalboard on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Focalboard on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Focalboard is a self-hosted, open-source Kanban and project-board server from the
Mattermost project — a Go backend serving a built React frontend for managing tasks,
boards, and workflows. This lab takes you through the full operational lifecycle of the
**Focalboard on Cloud Run** module on Google Cloud: deploy it, access and verify it, run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Focalboard product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the
  attachment bucket.
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

1. In the RAD platform, open **Focalboard (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`FOCALBOARD_ADMIN_PASSWORD` and the
   database password), a dedicated Cloud Storage bucket for board attachments,
   mirrors the `mattermost/focalboard` image into Artifact Registry, and runs a
   one-shot database-initialisation job that creates the application role and
   database. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~focalboard" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Focalboard has no
   dedicated health API — the startup, liveness, and readiness probes all target the
   web UI root, which returns 200 only once the Go server has bound its port and
   completed its own schema migrations:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Focalboard runs in `authMode = native` with no
   pre-seeded admin credential in Secret Manager — register the first account through
   the UI (name, email, password) and it automatically becomes the workspace owner.
   Public shared boards are enabled by default, so boards can be shared via public
   links once created.

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
   the next apply). Unlike apps that need Redis for multi-instance coordination,
   Focalboard keeps all board state in PostgreSQL and uses no cache or queue, so
   `max_instance_count` is safe to raise without any other prerequisite.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (the base image is
   mirrored from `mattermost/focalboard`) and a new revision rolls out. Focalboard
   applies its own schema migrations on every boot as the application database user,
   so upgrading the version applies schema changes automatically with no separate
   migration step.

4. **Manage secrets and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~focalboard"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Inspect the attachment bucket** — uploaded files (not board data) live here:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~focalboard"
   gcloud storage ls gs://<attachment-bucket>/
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=<db-user> --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The entrypoint prints the resolved
   DB host, name, user, and `sslmode` at startup, which is useful for confirming the
   connection wiring:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module's uptime check (`uptime_check_config`) is
   **disabled by default** — enable it and confirm it turns green under
   Monitoring → Uptime checks if you need synthetic availability monitoring.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Focalboard releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/` and allows up to **~7–8 minutes** on first boot (60s initial
  delay, 15s period, 30 retries).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed successfully.
  Focalboard's entrypoint regenerates `/opt/focalboard/config.json` from the
  Foundation-injected `DB_*` vars on every start (it has no env-var override), and on
  Cloud Run it prefers `DB_IP` over the Cloud SQL socket with `sslmode=require`.
- **`db-init` job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Attachment uploads fail but board editing still works:** the gcsfuse mount at
  `/data` (`enable_gcs_storage_volume`) is missing or misconfigured — board content
  itself lives in PostgreSQL and is unaffected, only file uploads are.
- **Image build failed:** review Cloud Build history for the failed mirroring/build
  step's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `application_database_name`/`application_database_user` are
effectively immutable after first deploy, and why `database_type` must stay
`POSTGRES_15`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, the attachment GCS bucket, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, attachment bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check (`/`) passes; register the first account in the UI to become owner |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs, inspect attachments, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, upload, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
