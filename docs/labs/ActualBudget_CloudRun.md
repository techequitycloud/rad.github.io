---
title: "ActualBudget on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy ActualBudget on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ActualBudget on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun)**

## Overview

**Estimated time:** 20–40 minutes

A personal budgeting application using envelope-based budgeting to track income and expenses. This lab takes you through the full operational lifecycle of the **ActualBudget on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on ActualBudget product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **ActualBudget (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs. Configure only what you need — the [Configuration Guide](https://docs.radmodules.dev/docs/modules/ActualBudget_CloudRun) documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a GCS data bucket, builds the container image. No database or initialisation job is required. First deploys take roughly **10–20 minutes** (image build dominates).

3. When it completes, discover the resources with name-agnostic filters (so the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Verify the service is healthy** by hitting the liveness endpoint:

   ```bash
   curl -s "$SERVICE_URL/health/live"
   ```

   Expect an HTTP 200 response confirming the service is running. If you receive a redirect or the response body contains `ok` or `healthy`, the service has started successfully.

2. **Open the ActualBudget UI** in your browser by navigating to `$SERVICE_URL`. ActualBudget does not require initial credentials — you will be prompted to create or import a budget file on first access. No password retrieval is needed before you can begin.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page — the module owns the service spec, so scaling is a configuration change, not a manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets and storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~actualbudget"
   gsutil ls -p "$PROJECT" | grep actualbudget
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU / memory utilisation. The module also provisions an **uptime check**; confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level diagnostics and do not change with ActualBudget releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs for startup errors.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, Secret Manager secrets, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Cloud Run service and GCS bucket provisioned; image built and deployed |
| 2 — Access & verify | Manual | Liveness endpoint returns 200; budget UI loads in browser |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision failures, build errors, and permission issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
