---
title: "Rocket.Chat on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Rocket.Chat on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Rocket.Chat on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Rocket.Chat is an open-source, self-hosted team-communication platform — a Slack/Teams
alternative with channels, direct messages, threads, and voice/video. This lab takes
you through the full operational lifecycle of the **Rocket.Chat on Cloud Run** module
on Google Cloud: deploy it, complete the first-run setup wizard, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Rocket.Chat product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the running service and complete the setup wizard (admin + organization).
- Perform day-2 operations — inspect, update, and manage backups and the API token.
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

1. In the RAD platform, open **RocketChat (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom container image — the official `rocketchat/rocket.chat`
   image with a **single-node MongoDB 6.0 replica set (`rs0`) baked in** — provisions
   a Cloud Storage bucket to back the MongoDB data directory (`/data/db`), and starts
   the Cloud Run service. There is **no Cloud SQL instance**; MongoDB is embedded. The
   image build dominates first-deploy time, which is roughly **15–25 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~rocketchat" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & complete the setup wizard [Manual]

1. Confirm the service is healthy. Rocket.Chat exposes an info endpoint that returns
   JSON with HTTP 200 only once the server and its embedded MongoDB replica set are
   ready:

   ```bash
   curl -s "$SERVICE_URL/api/info"   # expect {"version":"6.12.1","success":true,...}
   ```

   If it is not yet ready, confirm the replica set reached PRIMARY on boot:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50 \
     | grep -i "replica set rs0 is PRIMARY"
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Rocket.Chat launches the **4-step
   setup wizard** — no admin credential is pre-seeded:

   - **Step 1 — Admin Info:** enter your full name, a username, an admin email
     (use `admin@techequity.cloud` for RAD deployments), and a password.
   - **Step 2 — Organization Info:** organization name, type, industry, size, country.
   - **Step 3 — Register Server:** choose **Register** (to link Rocket.Chat Cloud for
     push notifications and marketplace apps) or **Keep standalone** for an air-gapped
     workspace.
   - **Step 4 — Complete:** you land in the admin workspace. Create your first channel
     and invite users.

3. (Optional, for a custom domain) Set `ROOT_URL` to your domain via
   `environment_variables` and apply an **Update** so invite links and OAuth callbacks
   resolve to the address users actually visit.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** The embedded MongoDB is a single writer
   against the same GCS-backed volume — `min_instance_count` and `max_instance_count`
   are both `1` by design. Increasing them would corrupt the database. Scale
   **vertically** (more CPU/memory) instead by changing the resource inputs and
   clicking **Update**.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Rocket.Chat runs its own schema migrations on start.

4. **Manage the API token and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"   # when enable_api_key = true
   gcloud run jobs list --project="$PROJECT" --region="$REGION"        # scheduled backup jobs
   ```

5. **Back up MongoDB** by running a `mongodump` against the embedded replica set (see
   the Configuration Guide for wiring a `cron_jobs` dump to the storage bucket).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — both Rocket.Chat and the embedded `mongod` log to Cloud Logging:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory utilisation.
   The module also provisions an **uptime check** against `/api/info`; confirm it is
   green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Rocket.Chat releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/api/info`; the app is not Ready
  until the embedded replica set is `PRIMARY`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`/api/info` never returns 200:** grep the logs for `replica set rs0 is PRIMARY`. If
  MongoDB never reaches PRIMARY, the GCS-backed `/data/db` volume may be missing or the
  instance may be under-provisioned on memory.
- **Data disappeared after a redeploy:** confirm the `<prefix>-storage` bucket exists
  and is still mounted as the `/data/db` volume — deleting it deletes the workspace.
- **`503`/timeout on the UI:** confirm `ingress_settings = "all"` (public) and that a
  single instance is running; the app is a single writer and must not scale out.
- **Image build failed:** review Cloud Build history for the failed build's log
  (MongoDB 6.0 must install from the bullseye repo — a base-image change can break it).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including never scaling beyond one instance and never deleting the data
volume).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the Cloud Storage bucket holding the MongoDB data, any Secret Manager API token, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image (Rocket.Chat + embedded MongoDB), provisions the data bucket, and starts Cloud Run |
| 2 — Access & setup wizard | Manual | Health check passes; complete the 4-step wizard (admin + organization) |
| 3 — Operate | Manual | Inspect revisions, update version, manage API token/backups; never scale out |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and the uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, replica-set, data-volume, ingress, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
