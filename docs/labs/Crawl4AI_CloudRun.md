---
title: "Crawl4AI on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Crawl4AI on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Crawl4AI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Crawl4AI is an open-source LLM-friendly web crawler and scraper designed for AI
teams building RAG pipelines, knowledge bases, and monitoring workflows. This lab
takes you through the full operational lifecycle of the **Crawl4AI on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Crawl4AI product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Crawl4AI (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run Gen2 service, mirrors the container
   image into Artifact Registry, configures VPC egress, and sets up Cloud
   Monitoring. Crawl4AI has no external database and no initialisation job —
   first deploys are faster than database-backed modules.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~crawl4ai" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. On first request, supervisord must start Redis
   then Gunicorn — allow up to 60 seconds for the initial response:

   ```bash
   curl -s "$SERVICE_URL/health"   # expect {"status":"ok"}
   ```

2. Crawl4AI has no admin login and no auto-generated credentials. The service is
   ready when the health check above returns `{"status":"ok"}`. An interactive
   playground is available at `${SERVICE_URL}/playground` in a browser —
   no sign-in is required by default.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the service spec, so scaling is a configuration
   change, not a manual `gcloud` edit (a manual edit would be reverted on the
   next apply).

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image is mirrored and a new revision rolls out.

4. **Manage secrets** (LLM API keys and the optional JWT secret are stored in
   Secret Manager if supplied at deploy time):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
   ```

5. Crawl4AI is **fully stateless** — it has no database, no backup jobs, and no
   persistent storage by default. Task results live in the embedded in-container
   Redis and are lost on container restart. No database session is needed.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module also provisions an
   **uptime check** (polling `/health`); confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Crawl4AI releases.

- **Revision unhealthy / service won't serve:** the startup probe hits `/health`
  after a 40-second initial delay to allow supervisord to boot Redis then
  Gunicorn. If the revision fails to become healthy, inspect its logs for
  supervisord or Chromium startup errors.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **OOM / Chromium crashes:** Chromium requires at least 4 GiB per instance.
  Review logs for OOM signals and increase `memory_limit` in the RAD platform.
- **Crawls fail immediately:** verify `vpc_egress_setting = "ALL_TRAFFIC"` —
  `PRIVATE_RANGES_ONLY` blocks all public crawl targets.
- **LLM extraction returns empty results:** check that any required LLM API keys
  were supplied via `secret_environment_variables` and that the secrets exist.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
  ```
- **Image build / mirror failed:** review Cloud Build history for the failed
  build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Secret Manager secrets (if any were provisioned), and Artifact Registry images.
Crawl4AI provisions no database, so there is no Cloud SQL instance to delete.
Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run Gen2, mirrors image, configures VPC egress and monitoring |
| 2 — Access & verify | Manual | Health check passes at `/health`; playground accessible |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision health, OOM, egress, LLM keys, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
