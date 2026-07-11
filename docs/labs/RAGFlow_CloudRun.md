---
title: "RAGFlow on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy RAGFlow on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# RAGFlow on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG)
platform. It ingests PDFs, Word documents, HTML pages, and other formats, chunks and
embeds them, stores vectors in Elasticsearch, and exposes a REST API and a web UI for
knowledge base management and enterprise search. This lab takes you through the full
operational lifecycle of the **RAGFlow on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on RAGFlow product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

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
- **Elasticsearch_GKE deployed** and its `elasticsearch_endpoint` output available —
  this is a hard deployment prerequisite; the plan is rejected if `elasticsearch_hosts`
  is empty when `deploy_application = true`.
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

1. In the RAD platform, open **RAGFlow (Cloud Run)**, set `project_id` and
   `elasticsearch_hosts` (the `elasticsearch_endpoint` output from your
   `Elasticsearch_GKE` deployment), and review the remaining inputs. Configure only
   what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/RAGFlow_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager secrets, a Cloud Storage bucket for document artifacts,
   optional NFS/Redis wiring, builds the container image, and runs a one-shot
   database-initialisation job. First deploys take roughly **20–35 minutes** (Cloud
   SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ragflow" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its dependencies:

   ```bash
   curl -s "$SERVICE_URL/v1/health"   # expect HTTP 200 with {"code":0}
   ```

   RAGFlow loads embedding models on first boot; if you see a 502 or connection
   refused, wait a few minutes for the startup probe to complete.

2. Open `$SERVICE_URL` in a browser. On first visit RAGFlow presents a registration
   page — create an admin account with an email and password of your choice and sign
   in. There is no pre-provisioned admin credential in Secret Manager; the database
   password secret is for the MySQL backend only.

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
   that `min_instance_count` is hard-capped at 1; scale-to-zero is not supported
   because RAGFlow loads embedding models at startup.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ragflow"
   gcloud storage buckets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init and any cron jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=ragflow --project="$PROJECT"
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
   / memory utilisation. The module also provisions an **uptime check** (when enabled);
   confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with RAGFlow releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed. RAGFlow requires
  MySQL 8.0 — verify `database_type = MYSQL_8_0`.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="name~ragflow"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Documents not processing (stuck in queue):** confirm Redis is reachable and
  `redis_host` is set — without Redis, RAGFlow's document workers never start.
- **Elasticsearch errors / failed indexing:** verify `elasticsearch_hosts` points to
  the correct Elasticsearch endpoint and the cluster health is green.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL (MySQL) database, Secret Manager secrets, Cloud Storage bucket, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL,
registry) are managed separately and are not removed here. The Elasticsearch_GKE
deployment must also be torn down separately.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL), Storage, secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; register admin account and sign in |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/storage/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, Redis/Elasticsearch, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
