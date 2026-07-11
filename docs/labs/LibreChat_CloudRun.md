---
title: "LibreChat on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy LibreChat on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LibreChat on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

LibreChat is an open-source AI chat interface that provides a unified experience across 20+
LLM providers including OpenAI, Anthropic, Google Gemini, and Ollama. This lab takes you
through the full operational lifecycle of the **LibreChat on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
LibreChat product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry, and
  shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **LibreChat (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, mirrors the LibreChat container image to
   Artifact Registry, auto-provisions a Firestore ENTERPRISE database with MongoDB
   compatibility (when no external `mongodb_uri` is supplied), generates cryptographic
   secrets in Secret Manager, and provisions a GCS uploads bucket. First deploys take
   roughly **10–20 minutes** (Firestore provisioning and image mirroring dominate).

3. When it completes, discover the resources with name-agnostic filters (so the commands
   keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~librechat" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its MongoDB database:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   # expect 200
   ```

   LibreChat's root path (`/`) returns HTTP 200 once the application is fully initialised
   and connected to MongoDB. If you receive 502 or 503, the service may still be starting
   up — wait 30 seconds and retry.

2. Open `$SERVICE_URL` in a browser. The LibreChat login and registration page appears.
   Register the initial admin account. After registration, navigate back to the RAD platform and
   set `allow_registration = false`, then apply it via **Update** to prevent unauthorised self-sign-ups on
   public deployments.

3. Confirm the auto-generated application secrets are in place:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"
   ```

   You should see secrets for `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`,
   and `mongo-uri`. These are injected at runtime as Secret Manager references — they never
   appear as plaintext in the Cloud Run revision spec.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page — the
   module owns the service spec, so scaling is a configuration change, not a manual `gcloud`
   edit (a manual edit would be reverted on the next apply). Note: if you are using the
   embedded Firestore MongoDB backend, keep `max_instance_count = 1`; increase it only when
   pointing at an external MongoDB with Redis session management enabled.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image is mirrored and a new revision rolls out.

4. **Manage secrets and storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"

   # Inspect the Firestore database used as the MongoDB backend
   gcloud firestore databases list --project="$PROJECT"

   # View the uploads GCS bucket
   UPLOADS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~librechat" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${UPLOADS_BUCKET}/"
   ```

5. **Inject AI provider API keys** using `secret_environment_variables` (not plain
   `environment_variables`) so they are never exposed in Cloud Run revision metadata or
   audit logs. Create the secrets in Secret Manager first, then reference them by name in
   the RAD platform and apply it via **Update**.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count,
   request latency (P50/P95/P99), instance count (scaling behaviour), and CPU / memory
   utilisation. The module also provisions an **uptime check**; confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LibreChat releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs
  for startup errors, and confirm env vars and secrets resolved correctly.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **MongoDB / Firestore connection errors:** confirm the Firestore database exists and the
  `mongo-uri` secret has a valid version. The auto-generated SCRAM URI is written by a
  provisioner on every apply — a missing or placeholder URI is the most common first-deploy
  failure.
  ```bash
  gcloud firestore databases list --project="$PROJECT"
  MONGO_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~librechat AND name~mongo-uri" --format="value(name)" --limit=1)
  gcloud secrets versions list "$MONGO_SECRET" --project="$PROJECT"
  ```
- **Image mirror failed:** review Cloud Build history in the console for the failed build
  log. The module mirrors the LibreChat image from GHCR to Artifact Registry on every
  deploy.
- **503 on startup:** LibreChat cold starts can take 15–30 seconds while the MongoDB
  connection is established and assets load. The startup probe has a generous failure
  threshold — wait for it to pass before diagnosing further.
- **403 / permission errors:** verify the runtime service account's IAM roles and confirm
  Secret Manager secrets are accessible to it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, Secret
Manager secrets, GCS uploads bucket, and Artifact Registry images. The **Firestore
database is intentionally retained** (ABANDON policy) to prevent data loss; delete it
manually via the GCP Console if it is no longer needed. Resources owned by **Services_GCP**
(the VPC, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Firestore, secrets, and GCS uploads bucket |
| 2 — Access & verify | Manual | Health check passes; register initial admin account; confirm secrets |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, MongoDB/Firestore, image-mirror, startup, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; Firestore database is retained |
