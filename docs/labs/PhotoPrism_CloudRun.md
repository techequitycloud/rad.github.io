---
title: "PhotoPrism on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy PhotoPrism on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PhotoPrism on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

PhotoPrism is a self-hosted, AI-powered photo and video management application —
it browses, organizes, and shares a personal media library with automatic tagging,
facial recognition, and full-text/visual search, all served from a single Go binary
with an embedded SQLite database. This lab takes you through the full operational
lifecycle of the **PhotoPrism on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on PhotoPrism product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the GCS FUSE-backed data volume.
- Perform day-2 operations — inspect, manage secrets, and back up the media library.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on). PhotoPrism itself
  provisions no Cloud SQL instance — it uses an embedded SQLite database.
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

1. In the RAD platform, open **PhotoPrism (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_CloudRun)
   documents every input by group, with defaults. Note that `memory_limit` defaults to
   `1Gi`; consider raising it before deploying if you expect a real photo/video library
   (see Task 3). Review the estimated cost (if credits are enabled) and click **Deploy**,
   which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (pinned to exactly one instance,
   `min=1`, `max=1`), a Cloud Storage bucket that is mounted into the container as a
   GCS FUSE volume at `/photoprism` (the only persistence layer — there is no Cloud
   SQL instance), and the auto-generated `PHOTOPRISM_ADMIN_PASSWORD` Secret Manager
   secret, then builds and mirrors the container image. There is no database-init job
   to wait on — PhotoPrism creates its own SQLite schema on first boot. First deploys
   typically complete in **10–20 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~photoprism" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. PhotoPrism exposes an unauthenticated status
   endpoint that responds once the HTTP server is up and the SQLite index is ready:

   ```bash
   curl -s "$SERVICE_URL/api/v1/status"   # expect a 200 JSON response
   ```

2. Retrieve the auto-generated admin password before logging in — no pre-seeded
   credential is shown anywhere else:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and sign in with username `admin` (or your
   configured `admin_username`) and the password retrieved above. Once you know the
   deployed URL, consider setting `site_url` to it in the RAD platform and applying via
   **Update** — this fixes absolute links and thumbnail URLs that otherwise fall back
   to the request host.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; PhotoPrism must never serve two revisions with live traffic
   simultaneously, since both would write to the same gcsfuse-mounted SQLite file):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count` and `max_instance_count`
   are both fixed at `1` by design — PhotoPrism serves one shared SQLite library from
   one writable gcsfuse volume, and a second concurrent writer risks database and
   index corruption. This is not a scaling dial to tune.

3. **Tune memory for your library size.** The module's own `memory_limit` variable
   defaults to `1Gi`, but PhotoPrism loads vector indexes into memory for face
   recognition and thumbnailing, and the application layer's own baseline
   recommendation is `4Gi` for real indexing workloads. If you see OOM kills in the
   logs (Task 4) as your library grows, raise `memory_limit` in the RAD platform and
   apply via **Update**.

4. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (pinned to a
   `PHOTOPRISM_VERSION` build tag, not the generic version input, when left at
   `latest`) and a new revision rolls out.

5. **Manage secrets and the media library bucket:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~photoprism"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~storage" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/photoprism/originals/"
   ```

6. **Back up the media library.** Because PhotoPrism has no SQL database, a backup is
   a filesystem archive of the GCS bucket contents (`backup_format = tar` by default),
   not a database dump. Review `backup_schedule` and `backup_retention_days` in the
   RAD platform, and raise retention for production libraries.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), and CPU / memory utilisation — watch memory
   closely as your library grows, since indexing and thumbnailing are memory-hungry.
   The module can provision an **uptime check** (disabled by default); enable it under
   `uptime_check_config` and confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with PhotoPrism releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/api/v1/status` and allows
  roughly 15s + 10×10s (~1 minute 55 seconds) for first-boot SQLite schema creation
  and index warm-up.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Container OOM-killed:** check the revision's memory utilisation in Monitoring; if
  it is pinned near the `memory_limit` ceiling, raise it (see Task 3) — 1Gi is the
  module default but under-sized for real libraries.
- **GCS FUSE mount failures:** confirm `execution_environment = "gen2"` — GCS FUSE
  volumes only work under gen2, and this is required, not optional, for this module.
- **Locked out of the admin account:** re-read the password from Secret Manager
  (Task 2); it is the source of truth and PhotoPrism re-applies it at every boot.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `max_instance_count` must never be raised above 1, and why
setting `database_type` away from `NONE` provisions a real, billed, but functionally
unused Cloud SQL instance).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the media library GCS bucket (including the embedded SQLite database and all
originals it contains — there is no separate database to drop), and Secret Manager
secrets. Resources owned by **Services_GCP** (the VPC, Artifact Registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a single-instance Cloud Run service, a GCS FUSE-mounted data bucket, and the admin-password secret — no database init to wait on |
| 2 — Access & verify | Manual | Health check passes; retrieve the auto-generated admin password and sign in |
| 3 — Operate | Manual | Inspect revisions (never scale beyond 1), tune memory for library size, update version, manage secrets and backups |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics, especially memory, and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, OOM, GCS FUSE mount, admin-credential, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the media library bucket |
