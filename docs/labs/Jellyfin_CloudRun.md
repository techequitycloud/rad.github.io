---
title: "Jellyfin on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Jellyfin on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Jellyfin on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellyfin_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Jellyfin is a free, open-source, self-hosted media server for streaming your own
movies, TV shows, music, photos, and live TV to any device. It is written in .NET
and began as a fork of Emby. This lab takes you through the full operational
lifecycle of the **Jellyfin on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Jellyfin product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellyfin_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Complete the Jellyfin first-run setup wizard and add a media library.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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

1. In the RAD platform, open **Jellyfin (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellyfin_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud Storage bucket mounted at
   `/config` via GCS FUSE (`enable_gcs_storage_volume = true`) to persist Jellyfin's
   configuration, internal SQLite databases, metadata, plugins, and transcode cache,
   and builds the container image (`jellyfin/jellyfin`, pinned to 10.10.3 when
   `application_version = "latest"`). Jellyfin needs **no external database** — it
   uses an embedded SQLite store under `/config`, so there is no Cloud SQL instance
   and no database-initialisation job. First deploys take roughly **8–15 minutes**
   (image build dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~jellyfin" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Jellyfin exposes an unauthenticated health
   endpoint that returns `Healthy` (200) once the server has fully started:

   ```bash
   curl -s "$SERVICE_URL/health"   # expect: Healthy
   ```

2. Open `$SERVICE_URL` in a browser. Jellyfin serves its web UI at `/web` (and at
   `/`) on container port 8096. On first visit you are taken straight into the
   **setup wizard** — there are **no default credentials**; the administrator
   account is created during the wizard (Task 3).

---

## Task 3 — Worked example: complete the wizard and add a media library [Manual]

This is the core Jellyfin workflow. You will finish first-run setup, create the
initial admin, add a media library backed by the persistent `/config` volume, and
confirm you can browse it.

1. **Complete the setup wizard.** With `$SERVICE_URL` open in the browser:
   - **Preferred display language** — choose your language and click **Next**.
   - **Create your admin account** — enter a username and a strong password. This
     becomes the Jellyfin owner; it is the only administrator until you add more.
     There is no pre-seeded credential in Secret Manager.
   - **Setup Media Libraries** — you can skip this here and add one in the next
     step from the Dashboard, or add your first library inline.
   - **Preferred metadata language / country** — set the language Jellyfin uses when
     it fetches artwork, descriptions, and other metadata, then **Next**.
   - **Remote access** — leave *Allow remote connections to this server* enabled
     (Cloud Run already fronts the service over HTTPS); you can leave automatic port
     mapping off. Click **Next**, then **Finish**. Jellyfin restarts into the login
     screen — sign in with the admin account you just created.

2. **Add a media library.** From the web UI, go to the user menu →
   **Dashboard** → **Libraries** → **Add Media Library**:
   - **Content type** — choose what the folder holds, e.g. **Movies**, **Shows**,
     **Music**, or **Photos**.
   - **Display name** — give the library a name (e.g. `Movies`).
   - **Folders** — click the **+** and point Jellyfin at a path *under the persistent
     volume*, e.g. `/config/media/movies`. Anything under `/config` is backed by the
     GCS-FUSE bucket and survives restarts and redeploys; a path outside `/config`
     lives on the container's ephemeral disk and is lost when the instance recycles.
     Create the folder and drop a sample file into it first if it does not exist
     (see the note below on getting media onto the volume).
   - Accept the metadata-download defaults and click **Ok**, then **Ok** again to
     save the library.

3. **Scan and fetch metadata.** Jellyfin scans the new library automatically; you can
   force a scan from **Dashboard → Libraries → Scan All Libraries** (or the three-dot
   menu on the library → **Scan Library**). It matches each file against online
   providers and downloads titles, artwork, and descriptions in the metadata
   language you chose.

4. **Browse and confirm playback.** Return to the Jellyfin home screen — your new
   library appears with its poster art. Open it, select an item, and press **Play**.
   For a smooth demo, prefer media the client can **direct-play** (a codec/container
   the browser supports natively): on-the-fly transcoding is CPU-heavy and there is
   no GPU on Cloud Run, so a transcode of a large file may stutter under the default
   1 vCPU.

> **Getting media onto the `/config` volume:** because `/config` is a GCS bucket
> mounted via FUSE, the simplest way to seed content is to copy files into the
> bucket directly. Find the bucket and upload into the library path you referenced
> above:
> ```bash
> BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
>   --filter="name~jellyfin" --format="value(name)" | head -1)
> gcloud storage cp ./my-movie.mp4 "gs://${BUCKET}/media/movies/"
> ```
> GCS FUSE is well suited to light or demo use; for a large real library or heavy
> streaming, the **GKE variant with a block PVC** is the better fit (see the
> [Jellyfin on GKE](Jellyfin_GKE.md) lab).

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling — keep it single-instance.** Jellyfin is a stateful single-server
   application: its SQLite databases and transcode cache live on one `/config`
   volume and are not designed for concurrent writers. The module defaults to
   `min_instance_count = 1` and `max_instance_count = 1` for exactly this reason —
   **keep `max_instance_count = 1`**. If playback needs more headroom, scale *up*
   (raise `cpu_limit` above the default `1000m` and `memory_limit` above `1Gi` for
   live transcoding), not *out*. Apply changes by editing the inputs and clicking
   **Update** — the module owns the service spec, so a manual `gcloud` edit would be
   reverted on the next apply.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Because the state lives on `/config`, the new revision picks up your libraries and
   settings.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~jellyfin"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~jellyfin" --format="value(name)" | head -1)
   gcloud storage ls "gs://${BUCKET}/"
   ```

   The state that matters is the `/config` volume — the SQLite databases plus
   metadata, plugins, and user settings. Back it up by copying the bucket
   (`gcloud storage cp -r "gs://${BUCKET}" gs://<backup-bucket>`). If you enabled the
   optional API key (`enable_api_key = true`), its 32-character value is stored in
   Secret Manager as `secret-<prefix>-<app>-api-key`; note that Jellyfin's own
   application API keys are created separately in **Dashboard → API Keys**.

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory
   utilisation. Watch CPU during playback — sustained saturation usually means a
   client is triggering a transcode and you should raise `cpu_limit` or steer clients
   toward direct-play. The module also provisions an **uptime check**; confirm it is
   green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Jellyfin releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm the `/config` volume mounted. The startup
  probe targets `/health`, which returns `Healthy` only once the server has finished
  initialising its SQLite store.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Libraries or settings disappeared after a redeploy:** confirm the media path you
  referenced is under `/config` (the persistent GCS-FUSE mount). A path outside
  `/config` is ephemeral and is lost on every instance recycle.
- **Playback stutters or times out:** almost always a transcode under a 1 vCPU
  limit. Prefer direct-play media, or raise `cpu_limit`/`memory_limit`. Note GCS FUSE
  adds read latency, which compounds during a transcode of a large file.
- **Media not appearing in a library:** re-run **Scan Library** and confirm the file
  actually landed in the bucket path (`gcloud storage ls`).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles,
  including read/write on the GCS-FUSE bucket.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping `max_instance_count = 1` and sizing CPU for transcoding).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the `/config` GCS bucket (**including your SQLite databases, metadata, and any media
you copied into it**), Secret Manager secrets, and Artifact Registry images. If you
want to keep your library, back up the bucket first (Task 4). Resources owned by
**Services_GCP** (the VPC, registry, shared service accounts) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the Cloud Run service, a `/config` GCS-FUSE bucket, and builds the image (no external DB) |
| 2 — Access & verify | Manual | `/health` returns `Healthy`; the setup wizard loads at the service URL |
| 3 — Worked example | Manual | Complete the wizard, create the admin, add a media library on `/config`, scan and browse |
| 4 — Operate | Manual | Inspect revisions, keep single-instance, size CPU, update version, back up `/config` |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose revision, persistence, transcoding, scan, build, and IAM issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources, including the `/config` bucket |
