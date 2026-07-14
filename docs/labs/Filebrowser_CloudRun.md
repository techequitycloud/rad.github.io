---
title: "Filebrowser on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Filebrowser on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Filebrowser on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

File Browser is a lightweight, open-source web file manager written in Go — it
serves a directory tree over HTTP for browsing, uploading, editing, and sharing
files, with no external database. This lab takes you through the full operational
lifecycle of the **Filebrowser on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Filebrowser product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the default admin login.
- Perform day-2 operations — inspect revisions, manage ingress, and inspect the
  persistent GCS-backed state.
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

1. In the RAD platform, open **Filebrowser (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_CloudRun)
   documents every input by group, with defaults. Note that **ingress defaults to
   `internal`** — decide up front whether you need `ingress_settings = "all"` for
   public access. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud Storage bucket mounted
   at `/database` via GCS FUSE (holding the embedded SQLite database), and builds
   the container image. There is no Cloud SQL instance, no Secret Manager
   application secret, and no database-initialisation job — Filebrowser is
   self-contained. First deploys typically complete in **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~filebrowser" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Filebrowser exposes an unauthenticated health
   endpoint that returns `200` as soon as the server is listening:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. If `ingress_settings` is still `internal` (the default), the URL above is only
   reachable from inside the VPC — curl it from a Cloud Shell/VM on the same
   network, or temporarily set `ingress_settings = "all"` in the RAD platform and
   apply via **Update** to reach it from your workstation.

3. Open `$SERVICE_URL` in a browser and log in with the seeded default credential
   **`admin` / `admin`**. Immediately change the password (and ideally the
   username) under **Settings → Profile** — this credential is well-known and
   grants full control of the file tree.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count = max_instance_count = 1`
   is intentional — the embedded SQLite database on the GCS FUSE mount does not
   tolerate concurrent writers. Leave `max_instance_count` at `1` in the RAD
   platform; a manual `gcloud` edit would be reverted on the next apply anyway.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Pin `application_version` explicitly in production rather than
   tracking `latest`.

4. **Change ingress or add access control** — flip `ingress_settings` between
   `internal` and `all`, or enable `enable_iap` with authorized users/groups, then
   apply via **Update**.

5. **Inspect the persistent state** — the SQLite database lives in the `/database`
   GCS bucket reported in the deployment Outputs. Never delete this bucket; doing
   so destroys all users, settings, and share links:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/
   gcloud storage ls gs://<data-bucket>/filebrowser.db
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
   count, request latency, instance count (should stay at 1), and CPU / memory
   utilisation. If `uptime_check_config` is enabled, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Filebrowser releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/health` with a 15-second
  delay — startup is fast since there are no migrations to wait on.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Service unreachable from your workstation:** check `ingress_settings` — the
  default is `internal` (VPC-only), which is expected behaviour, not a fault.
- **GCS FUSE mount / state not persisting:** confirm `execution_environment = gen2`
  (required for the `/database` GCS FUSE mount) and that the `/database` bucket
  still exists.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
  ```
- **Login shows `admin`/`admin` still active after redeploy:** this is expected —
  the credential is seeded only if no SQLite DB exists yet at `/database`. If a
  fresh admin/admin prompt appears unexpectedly, the `/database` bucket may have
  been replaced or emptied; check for a bucket deletion/recreation in Cloud Audit
  Logs.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `max_instance_count = 1` and to never
delete the `/database` bucket).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, the `/database` GCS bucket (including the embedded SQLite database — this is destructive and unrecoverable), and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run and the `/database` GCS FUSE bucket; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Health check passes; log in with seeded `admin`/`admin` and change the password immediately |
| 3 — Operate | Manual | Inspect revisions, keep `max_instance_count = 1`, update version, adjust ingress, inspect GCS state |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, ingress, GCS FUSE, and build/IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service and the `/database` bucket (destructive) |
