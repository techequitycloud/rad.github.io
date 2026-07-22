---
title: "LubeLogger on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy LubeLogger on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LubeLogger on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

LubeLogger is a free, open-source vehicle maintenance and fuel-mileage tracker
(ASP.NET Core, embedded LiteDB database). This lab takes you through the full
operational lifecycle of the **LubeLogger on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on LubeLogger product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the self-service first-run
  registration flow.
- Perform day-2 operations — inspect, scale (understanding why it's fixed at one
  instance), update, and manage storage.
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

1. In the RAD platform, open **LubeLogger (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service (no Cloud SQL — LubeLogger's default
   mode uses an internal embedded LiteDB database file), two Cloud Storage buckets
   (`storage` for app data, `dpkeys` for ASP.NET Core Data Protection keys), and
   mirrors the official prebuilt image into Artifact Registry. There is no build
   step and no database-initialisation job, so first deploys are fast — typically
   **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~lubelogger" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. LubeLogger exposes its public, unauthenticated
   `/Login` page — the same path the platform's own health probes use:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/Login"   # expect 200
   ```

2. Open `$SERVICE_URL/Login` in a browser. There is **no pre-seeded admin
   credential** — click **Register** and create the first account (name, email,
   password). Because `EnableAuth = "true"` is on by default, this is the ONLY way
   to gain access; the app root `/` redirects unauthenticated visitors to `/Login`.
   Complete this step immediately after deploy, since the Register form itself is
   reachable by anyone with the URL until a first account exists.

3. After logging in, add a vehicle and a maintenance/fuel record to confirm the
   database write path (embedded LiteDB, persisted on the `storage` GCS volume) is
   working. Refresh the page and confirm the record is still there.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling is intentionally fixed at one instance.** `min_instance_count = 1` and
   `max_instance_count = 1` are enforced by a plan-time validation guard —
   LubeLogger's default mode serves one shared embedded database file from one
   volume, so running multiple replicas risks corruption. There is no supported way
   to horizontally scale this module in its default (embedded LiteDB) configuration.

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**; since the image is prebuilt (not
   custom-built), this directly selects the corresponding
   `ghcr.io/hargata/lubelogger` release tag and a new revision rolls out.

4. **Inspect storage:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~lubelogger"
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
   count, request latency (P50/P95/P99), and CPU / memory utilisation (expect a flat
   single instance, no scaling activity). The module can provision an **uptime
   check** (when `uptime_check_config.enabled = true` — it defaults to `false`); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LubeLogger releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/Login` and should pass within
  seconds of the container starting — a persistent failure here usually means the
  container isn't listening on port 8080, not a slow first-boot migration (there is
  none).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Data not persisting across revisions/restarts:** confirm the `storage` GCS
  volume is actually mounted at `/App/data` — check the revision's volume mounts in
  `gcloud run revisions describe`.
- **Logged out unexpectedly after a redeploy:** confirm the `dpkeys` bucket exists
  and is mounted at `/root/.aspnet/DataProtection-Keys` — if it was ever
  deleted/recreated, all existing sessions are invalidated (not fatal, just requires
  re-login).
- **`/` returns a redirect/401 instead of the app:** expected behaviour when
  `EnableAuth = "true"` and you are not logged in — the app root is
  `[Authorize]`-gated. Go to `/Login` directly.
- **Image build failed:** review Cloud Build history — the module mirrors the
  official image; a failure here usually indicates a GHCR rate limit or transient
  network issue, not an application bug.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `max_instance_count = 1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service and both Cloud Storage buckets (**all vehicle records and uploaded documents are lost**). Resources owned by **Services_GCP** (the VPC, Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, two Cloud Storage buckets, and mirrors the prebuilt image (no database, no build step) |
| 2 — Access & verify | Manual | Health check passes; register the first account and confirm a record persists |
| 3 — Operate | Manual | Inspect revisions, understand the fixed single-instance constraint, update version, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, storage/persistence, session, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including all data |
