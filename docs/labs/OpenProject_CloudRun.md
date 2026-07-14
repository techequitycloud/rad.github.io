---
title: "OpenProject on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy OpenProject on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# OpenProject on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

OpenProject is an open-source project-management and collaboration suite — work
packages, Gantt timelines, agile boards, wikis, time tracking, and budgets. This lab
takes you through the full operational lifecycle of the **OpenProject on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on OpenProject product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the first-login password change.
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

1. In the RAD platform, open **OpenProject (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY_BASE` and the database
   password), a Cloud Filestore NFS instance for attachment storage, builds the
   container image, and runs the two initialization jobs — `db-init` (role +
   database) then `db-migrate` (`rake db:migrate db:seed`, which builds the schema
   and seeds the default admin). First deploys take roughly **25–40 minutes**
   (Cloud SQL creation and the migration seed dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~openproject" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. OpenProject exposes
   a health endpoint that responds only when Rails is fully initialised and
   PostgreSQL is reachable (query it on the service URL so the `Host` header is
   accepted by Rails Host Authorization):

   ```bash
   curl -s "$SERVICE_URL/health_checks/default"   # expect "PASSED" / HTTP 200
   ```

2. Open `$SERVICE_URL` in a browser. Sign in with the seeded credentials
   **`admin` / `admin`** — OpenProject immediately forces you to set a new admin
   password. Set a strong one and store it in your password manager. After that,
   create your first project and confirm work packages, the wiki, and attachments
   work (attachments are written to the NFS mount).

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Note
   that OpenProject keeps `cpu_always_allocated = true` and `min_instance_count = 1`
   by default so the in-process `good_job` worker and cron keep running between
   requests.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds, the `db-migrate` job runs any
   new migrations, and a new revision rolls out. OpenProject publishes numeric major
   tags only — pin to a specific major (e.g. `16`) rather than `latest`.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~openproject"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, db-migrate, backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=openproject --project="$PROJECT"
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
   CPU / memory utilisation. The module also provisions an **uptime check**; confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OpenProject releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is **TCP** (Puma port-listening) — an HTTP probe would fail Rails Host
  Authorization, so do not switch it to HTTP.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **"You have N pending migrations" in logs:** the `db-migrate` job did not complete.
  List its executions and read the failed one's logs — the migrate job is
  self-verifying, so a real failure fails the apply loudly rather than shipping an
  empty DB.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Database connection errors (`connection refused` / `SSL required`):** confirm the
  Cloud SQL instance is `RUNNABLE`, the DB password secret exists, and — because
  Cloud Run connects over **private-IP TCP with `sslmode=require`** — that
  `enable_cloudsql_volume` is left at its `false` default (enabling the socket breaks
  the Rails URL DSN).
- **Attachments disappear after a redeploy:** confirm `enable_nfs = true` and that the
  Filestore instance is healthy — without NFS, attachments land on ephemeral disk.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `SECRET_KEY_BASE` after first
boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, Filestore instance, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, Filestore, and runs `db-init` + `db-migrate` |
| 2 — Access & verify | Manual | Health check passes; sign in as `admin`/`admin` and set a new password |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, migration, database, NFS, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
