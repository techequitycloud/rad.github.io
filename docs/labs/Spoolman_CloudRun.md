---
title: "Spoolman on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Spoolman on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Spoolman on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun)**

## Overview

**Estimated time:** 30–45 minutes

Spoolman is an open-source inventory and usage tracker for 3D-printing filament
spools. This lab takes you through the full operational lifecycle of the
**Spoolman on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Spoolman product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
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

1. In the RAD platform, open **Spoolman (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Spoolman_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service and a Cloud SQL (PostgreSQL
   15) database with its Secret Manager password secret, and pulls the
   prebuilt `ghcr.io/donkie/spoolman` image directly — there is no Cloud Build
   step and no database-initialization job to wait for (Spoolman migrates
   itself on boot). First deploys take roughly **15–25 minutes** (Cloud SQL
   creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~spoolman" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database:

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect a 200/OK JSON status
   ```

2. Open `$SERVICE_URL` in a browser. Spoolman has **no login gate** — the UI
   loads directly into the spool inventory dashboard with no admin account to
   create. If you need to restrict access, apply IAP or a Cloud Armor
   allowlist now, before sharing the URL with anyone else.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would
   be reverted on the next apply). Spoolman has no background work, so
   scale-to-zero (`min_instance_count = 0`) is safe at any time.

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; Cloud Run pulls the new tag
   directly from `ghcr.io/donkie/spoolman` — no rebuild is needed since this is
   a genuinely prebuilt image.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~spoolman"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=spoolman --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and
   CPU/memory utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true`); if enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Spoolman releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm the `SPOOLMAN_DB_*` env vars
  resolved. The startup probe targets `/api/health` with a short 10-second
  initial delay — Spoolman boots fast since there's no schema-migration job
  to wait on separately.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE` and the DB password secret exists. Since there is no init job,
  this class of failure surfaces directly in the service's own boot logs.
- **App runs but shows an empty inventory using SQLite instead of Postgres:**
  check whether `SPOOLMAN_DB_TYPE=postgres` was accidentally overridden or
  unset in `environment_variables` — Spoolman silently falls back to a
  throwaway local SQLite file with no error if this variable is missing.
  ```bash
  gcloud run revisions describe <revision> --project="$PROJECT" --region="$REGION" \
    --format='value(spec.containers[0].env)' | tr ';' '\n' | grep -i spoolman_db
  ```
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the lack of built-in authentication).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, and Secret Manager secrets.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run and Cloud SQL (PostgreSQL 15) with its password secret; no build, no init job |
| 2 — Access & verify | Manual | Health check passes; UI loads directly with no login gate |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, and DB-engine-fallback issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
