---
title: "NetBox on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy NetBox on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# NetBox on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun)**

## Overview

**Estimated time:** 60–90 minutes

NetBox is the industry-standard open-source network and infrastructure
documentation / IPAM (IP address management) tool — device and rack
inventory, IP address and prefix tracking, cabling, and network topology,
modeled as structured data behind a full API. This lab takes you through the
full operational lifecycle of the **NetBox on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on NetBox product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including confirming media uploads
  actually persist to Cloud Storage.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  Redis/background-worker misconfiguration.
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

1. In the RAD platform, open **NetBox (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY`, `SUPERUSER_PASSWORD`,
   and the database password), a Cloud Storage `media` bucket, builds the
   custom container image (wrapping `netboxcommunity/netbox`), and runs a
   one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~netbox" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. NetBox's public login page responds only
   once the server is fully initialised and PostgreSQL is reachable:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/login/"   # expect 200
   ```

2. Open `$SERVICE_URL/login/` in a browser. Retrieve the auto-generated
   admin credentials and log in:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Log in as `admin` (or your configured `admin_user`) with that password.
   You should land on the NetBox dashboard.

3. **Verify media uploads actually persist** — this exercises the exact code
   path this module needed a real fix for. In the NetBox UI, upload an image
   attachment to any object (e.g. add an image attachment to a device or
   site), then confirm it landed in the backing GCS bucket, not just the
   container's local disk:

   ```bash
   MEDIA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~media" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$MEDIA_BUCKET/"
   ```

   You should see the uploaded file within a few seconds. If the bucket is
   empty despite a successful-looking upload in the UI, see Task 5.

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
   be reverted on the next apply). Note that NetBox's background RQ worker
   (webhooks, reports, scripts, scheduled jobs) is co-located in the same
   container and only runs while an instance is warm under the default
   cost-first (`cpu_always_allocated = false`, `min_instance_count = 0`)
   scaling — set `cpu_always_allocated = true` and `min_instance_count >= 1`
   together to keep it continuously active.

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds (passing
   `application_version` through as the Dockerfile's `APPLICATION_VERSION`
   build ARG) and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netbox"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=netbox --project="$PROJECT"
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
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module can provision an
   **uptime check** (`uptime_check_config.enabled = true`, defaults to `true`
   with `path = "/login/"`); confirm it is green under Monitoring → Uptime
   checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with NetBox releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe targets `/login/` and allows up to 60 retries at 10-second
  intervals on first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login fails with a CSRF error:** the service's `CSRF_TRUSTED_ORIGINS` must
  match its actual URL. Confirm:
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
    --format='value(status.url)'
  ```
  If this doesn't match the URL you're browsing to, the deployment is
  misconfigured — re-check the `service_url` wiring rather than assuming a
  browser-side cookie issue.
- **Uploads "succeed" in the UI but never show up in the GCS bucket:** this is
  the exact class of bug this module was fixed for once already — a GCS Fuse
  volume mounted at the wrong path leaves uploads on the ephemeral container
  filesystem, where they read back fine (fooling a quick UI check) but vanish
  on the next revision/restart. Confirm the mount path is NetBox's real
  `MEDIA_ROOT` (`/etc/netbox/media`, not `/opt/netbox/netbox/media`) and check
  the bucket directly rather than trusting the UI alone:
  ```bash
  gcloud storage ls "gs://$MEDIA_BUCKET/"
  ```
- **Webhooks / reports / scheduled jobs never run:** NetBox's background RQ
  worker only executes while an instance is warm under the default cost-first
  scaling. Set `cpu_always_allocated = true` and `min_instance_count >= 1` if
  continuous background processing is required.
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the initialisation job
  completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS
buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, media bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; log in with the auto-generated admin credential; confirm media uploads land in GCS |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, CSRF, media-persistence, background-worker, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
