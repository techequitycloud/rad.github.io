---
title: "Calibre-Web on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Calibre-Web on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Calibre-Web on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Calibre-Web is a self-hosted web app for browsing, reading, and downloading ebooks
from a Calibre library — it serves an in-browser reader, an OPDS feed, and Kobo
sync on top of the upstream LinuxServer.io image. This lab takes you through the
full operational lifecycle of the **Calibre-Web on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Calibre-Web product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, and manage the admin login and the `/config` bucket.
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

1. In the RAD platform, open **Calibre-Web (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform builds and mirrors the container image (pinned to a known-good
   `0.6.24` tag when `application_version = "latest"`), provisions the Cloud Run
   service, a Secret Manager secret (`CALIBRE_ADMIN_PASSWORD`), and a Cloud Storage
   bucket mounted at `/config` via GCS Fuse. There is no database and no
   initialisation job — Calibre-Web manages its own SQLite storage on first boot.
   First deploys typically take **5–15 minutes** (mostly the container build).

3. When it completes, discover the resource with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~calibreweb" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Calibre-Web's startup and liveness probes both
   target the root path, which serves the login page unauthenticated:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Sign in with the upstream image's built-in
   default credentials — **`admin` / `admin123`** — the auto-generated
   `CALIBRE_ADMIN_PASSWORD` secret in Secret Manager is **not** wired into the
   container's login flow. Immediately after first sign-in, change the admin
   password in the Calibre-Web UI (Admin → Edit User); optionally use the
   generated secret's value as the new password:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Point Calibre-Web at your ebook library: use the in-app setup wizard to set the
   library location to `/books` (empty on first run — upload or sync ebooks into it
   afterwards).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not raise `max_instance_count` above `1`.** Every Cloud Run instance
   mounts the same GCS-Fuse-backed bucket at `/config`; more than one instance
   writing to the same SQLite files (`app.db`, Calibre's `metadata.db`)
   concurrently risks corruption under gcsfuse's relaxed consistency model. Scaling
   is otherwise a configuration change in the RAD platform (change the min/max
   instance inputs and click **Update**), not a manual `gcloud` edit — a manual
   edit would be reverted on the next apply.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (pinned via the
   app-specific `CALIBREWEB_VERSION` build ARG) and a new revision rolls out.

4. **Inspect the `/config` bucket** (holds the SQLite databases, configuration,
   cache, and logs):

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~calibreweb" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~calibreweb"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # only user-supplied jobs, if any
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
   count, request latency, instance count, and CPU / memory utilisation. Uptime
   checks are **disabled by default** (`uptime_check_config.enabled = false`) —
   enable one in the RAD platform if you want automated availability alerting.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Calibre-Web releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/` (the login page, `200`,
  no authentication required) with a generous `failure_threshold=10` at
  `period=10s`, so a slow-starting container still has time to pass.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login fails with the built-in credentials:** confirm you are using
  `admin` / `admin123` (the upstream default), not the `CALIBRE_ADMIN_PASSWORD`
  Secret Manager value — that secret is provisioned but not applied to the
  container's actual login flow.
- **`/config` looks empty or reset after a redeploy:** confirm the GCS-Fuse-backed
  `storage` bucket still exists and is still mounted (`create_cloud_storage =
  true`); a new bucket would explain an apparently "reset" library.
- **Suspected SQLite corruption under load:** this module has no block-storage
  option — `/config` is always GCS-Fuse-backed, which the module's own
  description flags as suited to development/light use only. If you are seeing
  write errors or corruption, this is expected under concurrent or heavy access;
  migrate to `CalibreWeb_GKE` (block PVC) for production use rather than trying to
  tune this module further.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas. Note two confirmed documentation-vs-source mismatches to be aware of
while troubleshooting: the `liveness_probe` variable's description text mentions a
`/health` endpoint that does not exist (the actual configured path is `/` —
do not change it to `/health`), and the `calibreweb_url` output's description in
`outputs.tf` is a stale copy-paste referencing a "REST API (port 6333)" from an
unrelated module — the value is simply the normal Cloud Run service URL.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the `CALIBRE_ADMIN_PASSWORD` secret, the `/config` Cloud Storage bucket, and
Artifact Registry images (including your ebook library and Calibre-Web's SQLite
databases, since they live only in that bucket). Resources owned by
**Services_GCP** (the VPC, Artifact Registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, a Secret Manager admin-password secret, and a GCS-Fuse `/config` bucket; no database |
| 2 — Access & verify | Manual | Health check passes; sign in with `admin`/`admin123` and change the password immediately |
| 3 — Operate | Manual | Inspect revisions, keep `max_instance_count=1`, update version, inspect the `/config` bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics (uptime check optional, off by default) |
| 5 — Troubleshoot | Manual | Diagnose revision, login, storage, and build issues; two known doc/source mismatches noted |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the ebook library and SQLite state |
