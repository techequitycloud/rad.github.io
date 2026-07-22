---
title: "Speedtest Tracker on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Speedtest Tracker on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Speedtest Tracker on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Speedtest Tracker is an open-source, self-hosted internet speed test monitoring
tool that runs automated speed tests on a schedule and charts the results over
time. This lab takes you through the full operational lifecycle of the
**Speedtest Tracker on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Speedtest Tracker product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale (correctly, given the cron scheduler),
  update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the
  "looks healthy but the schedule never fires" failure mode.
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

1. In the RAD platform, open **Speedtest Tracker (Cloud Run)**, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service (kept always-on so its cron
   scheduler fires reliably), a Cloud SQL (MySQL 8.0) database with its Secret
   Manager secrets (`APP_KEY` and the database password), and runs a one-shot
   database-initialisation job. First deploys take roughly **15–25 minutes** (Cloud
   SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~speedtesttracker" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Speedtest Tracker
   exposes an unauthenticated health endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/healthcheck"   # expect a 200 JSON message
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Speedtest Tracker's setup
   wizard walks you through creating the initial administrator account — no
   pre-seeded admin credential exists in Secret Manager. After the admin account is
   created, review the **Settings → General** page and confirm the speed test
   schedule (`SPEEDTEST_SCHEDULE`) matches what you expect; trigger an on-demand
   test from the dashboard to confirm end-to-end connectivity works before relying
   on the schedule.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale carefully — this app is NOT a typical scale-out candidate.** Speedtest
   Tracker's in-process Laravel scheduler has no cross-instance coordination, so
   `max_instance_count` must stay at `1` while `speedtest_schedule` is set (a
   plan-time validation enforces this). Do not raise `max_instance_count` unless
   you disable the schedule and use this deployment purely as a multi-instance
   dashboard. Also do not set `min_instance_count = 0` or
   `cpu_always_allocated = false` — either change silently stops the schedule from
   ever firing while the service still reports healthy.

3. **Update the application version tag** by changing the version input in the RAD
   platform and applying it via **Update**; a new image is pulled and a new
   revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~speedtesttracker"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=speedtesttracker --project="$PROJECT"
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
   count, request latency, instance count, and CPU / memory utilisation. Because
   this service is always-on (`min_instance_count = 1`), expect a flat 1-instance
   baseline rather than scale-to-zero behaviour. The module can provision an
   **uptime check** (when `uptime_check_config.enabled = true` — it defaults to
   `false`); if enabled, confirm it is green under Monitoring → Uptime checks.

3. **Confirm the schedule is actually firing** — check the dashboard's results
   history for new entries appearing at the expected cadence. A service that is
   `Ready` and passes health checks can still have a silently-dead schedule if
   `cpu_always_allocated` or `min_instance_count` were ever changed away from their
   defaults — the results history is the definitive signal, not the revision
   status.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Speedtest Tracker releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **"Healthy but no new results ever appear":** this is the #1 Speedtest
  Tracker-specific symptom. Verify `cpu_always_allocated = true` and
  `min_instance_count >= 1` on the deployed revision — if either was changed, the
  in-process cron scheduler stops completing its work under Cloud Run's
  request-based CPU throttling, even though the revision itself reports `Ready`.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.metadata.annotations)' | grep -i cpu-throttling
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image pull / exec failures:** if the LinuxServer image's s6-overlay init never
  prints its startup banner in the logs (zero container output before "Application
  exec likely failed"), this is the documented s6-overlay-under-gVisor
  incompatibility class — switch `container_image` to
  `ghcr.io/alexjustesen/speedtest-tracker:<tag>` (Alpine-based) as a fallback.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, and Secret Manager secrets. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (always-on), Cloud SQL (MySQL 8.0), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; create the initial admin account in the UI; trigger a test test |
| 3 — Operate | Manual | Inspect revisions, scale carefully (max=1), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; confirm the schedule is actually producing new results |
| 5 — Troubleshoot | Manual | Diagnose revision, "healthy but no results," database, init-job, and image issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
