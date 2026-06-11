---
title: "Kestra on Cloud Run \u2014 Lab Guide"
---

# Kestra on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Kestra is an open-source data orchestration and workflow scheduling platform that uses
declarative YAML-based flow definitions and a rich plugin ecosystem for ETL/ELT pipelines,
batch jobs, and API automation. This lab takes you through the full operational lifecycle of
the **Kestra on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
Kestra product features. For the complete list of provisioned services and every configuration
input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
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

1. Click **Deploy** in the RAD platform top navigation, open **Kestra (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kestra_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets, a dedicated GCS storage bucket, builds the container
   image, and runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates; Kestra's JVM startup adds additional
   time on the first boot while database migrations are applied).

3. When it completes, discover the resources with name-agnostic filters (so the commands
   keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~kestra" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database:

   ```bash
   curl -s "$SERVICE_URL/health"   # expect {"status":"UP"}
   ```

   > Kestra uses a Java JVM with a slow first boot. If you receive a `503` immediately
   > after deployment, the service may still be completing its database migration. The
   > startup probe allows up to ~14 minutes — wait a few minutes and retry.

2. Retrieve the admin password from Secret Manager and sign in to the Kestra UI at
   `$SERVICE_URL`:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~kestra AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   The admin username is `admin`. Kestra's own product documentation covers the UI,
   flow editor, and plugin ecosystem.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a manual
   `gcloud` edit (a manual edit would be reverted on the next apply). Note that Kestra's
   standalone mode requires `max_instance_count = 1` to prevent queue-lock conflicts.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out with schema migrations
   applied automatically.

4. **Manage secrets, backups, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~kestra"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=kestra --project="$PROJECT"
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
   memory utilisation. The module also provisions an **uptime check** targeting the
   `/health` endpoint; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Kestra releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs
  for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Slow startup / 503 on first boot:** Kestra performs Flyway database migrations on
  startup. The startup probe allows up to ~14 minutes. Check the logs for migration
  progress before concluding there is a fault.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret exists, and the `db-init` initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, Cloud
SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately
and are not removed here.

> If the destroy reports a serverless subnet error, wait 20–30 minutes and retry — GCP
> releases serverless IPv4 addresses asynchronously after the Cloud Run service is deleted.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes (`{"status":"UP"}`); sign in to the Kestra UI |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, JVM startup, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
