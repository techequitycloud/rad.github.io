---
title: "ToolJet on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy ToolJet on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ToolJet on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

ToolJet is an open-source, low-code platform for building and deploying internal
tools — dashboards, admin panels, and CRUD apps — with a drag-and-drop builder over
your own databases and APIs. This lab takes you through the full operational
lifecycle of the **ToolJet on Cloud Run** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on ToolJet product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete the first-run setup wizard.
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

1. In the RAD platform, open **ToolJet (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   instance with **two databases** (the metadata DB and the ToolJet Database) and
   their Secret Manager secrets (`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`,
   `PGRST_JWT_SECRET`, and the database password), builds the container image, and
   runs a one-shot database-initialisation job (creating both databases and the
   `CREATEROLE` app role). First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tooljet" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. ToolJet exposes a
   public health endpoint that returns 200 once the server has finished its on-boot
   migrations and is listening:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/health"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit ToolJet presents a **setup
   wizard** — because `DISABLE_SIGNUPS = "true"` ships on, this is the only way to
   create the first account. Fill in your name, email, and a password to create the
   initial **admin user and workspace**; you then land in the ToolJet app builder.
   There is no pre-seeded admin credential in Secret Manager.

3. From the builder, create a datasource (for example a PostgreSQL or REST
   connection) to confirm credential storage works — ToolJet encrypts it at rest with
   the `LOCKBOX_MASTER_KEY`. The built-in **ToolJet Database** (served by the
   in-container PostgREST) is also available under the *Database* tab.

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
   `min_instance_count = 1` and `cpu_always_allocated = true` so ToolJet's in-process
   background worker is never throttled to zero.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   The entrypoint re-runs `db:migrate:prod`, so schema changes for the new version are
   applied before traffic shifts.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tooljet"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance (note the two databases):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=tooljet --database=tooljet --project="$PROJECT"
   gcloud sql connect "$INSTANCE" --user=tooljet --database=tooljet_db --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Look for the `[cloud-entrypoint]` lines confirming the config and the
   `db:migrate:prod` run.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module also provisions an **uptime check**; confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ToolJet releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/api/health` with a wide budget (30 × 15 s) to absorb first-boot
  migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`relation "user_sessions" does not exist` (or similar):** the migrations did not
  run — check the logs for the `db:migrate:prod` step and confirm it did not fail
  (the entrypoint aborts the boot on a migration failure).
- **`permission denied to create role` when creating a workspace:** the app role is
  missing the `CREATEROLE` attribute — re-run the `db-init` job.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `LOCKBOX_MASTER_KEY` after first
boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
both Cloud SQL databases, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (two PostgreSQL 15 databases), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; complete the setup wizard to create the admin + workspace and land in the app builder |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, migration, role, database, init-job, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
