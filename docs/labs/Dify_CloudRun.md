---
title: "Dify on Cloud Run \u2014 Lab Guide"
---

# Dify on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Dify is an open-source LLM application development platform for building
production-grade AI applications with a visual workflow builder, RAG pipeline,
agent framework, and multi-model management. This lab takes you through the full
operational lifecycle of the **Dify on Cloud Run** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Dify product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the web frontend.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, Filestore NFS, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Dify (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions two Cloud Run services (the API+Celery service and the
   Next.js web frontend), a Cloud SQL (PostgreSQL 15 with pgvector) database with its
   Secret Manager secrets, a dedicated GCS storage bucket, Redis via the NFS server,
   builds the container image, and runs a one-shot database-initialisation job. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   # API service
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify" \
     --format="value(metadata.name)" --limit=1)
   API_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   # Web frontend service (the URL to open in a browser)
   WEB_SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify-web" --format="value(metadata.name)" --limit=1)
   WEB_URL=$(gcloud run services describe "$WEB_SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   echo "API service: $SERVICE   ($API_URL)"
   echo "Web service: $WEB_SERVICE   ($WEB_URL)"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the API service is healthy and connected to its database:

   ```bash
   curl -s "$API_URL/health"   # expect {"status":"ok"}
   ```

2. Dify does not store a pre-generated admin password in Secret Manager. On the first
   visit the application displays a **setup wizard** where you create the admin account.
   Open the web frontend URL in a browser and complete the setup:

   ```bash
   echo "$WEB_URL"
   ```

   Enter your admin email and a password when prompted. After completing setup, the Dify
   console opens. Dify's own product documentation covers the workflow builder, RAG
   pipeline, and LLM provider configuration.

3. Confirm both services are listed and the `SECRET_KEY` (session signing key) is present
   in Secret Manager:

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~dify"

   gcloud secrets list --project="$PROJECT" --filter="name~dify AND name~secret-key"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the services and their revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `min_instance_count` at 1 or higher so the embedded Celery worker maintains its
   Redis broker connection.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out to both services.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~dify"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dify"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --filter="name~dify" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=dify_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for each service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check** targeting
   `/health`; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Dify releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The API server and database migrations run on every start,
  so allow the configured startup probe delay before expecting traffic.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists and is injected, and the db-init job completed. Without
  the Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true`) the container
  cannot reach the database at all.
- **Celery tasks not running / async failures:** Redis is required for all background
  processing. Confirm NFS is enabled (required when no external Redis host is set) and
  that the `NFS_SERVER_IP` placeholder resolved correctly in the service environment.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~dify AND metadata.name~db-init" \
    --format="value(metadata.name)" --limit=1)
  gcloud run jobs executions list --job="$JOB" --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles and that
  the GCS storage bucket and Secret Manager secrets are accessible.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — both Cloud Run services,
the Cloud SQL database, the GCS storage bucket, Secret Manager secrets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, Filestore NFS, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions two Cloud Run services, Cloud SQL (PostgreSQL + pgvector), secrets, GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; complete the admin setup wizard via the web frontend |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, Celery/Redis, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
