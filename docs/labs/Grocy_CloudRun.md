---
title: "Grocy on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Grocy on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Grocy on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Grocy is a self-hosted grocery and household ERP — inventory tracking with barcode
scanning, chore/task management, shopping lists, and meal planning. This lab takes
you through the full operational lifecycle of the **Grocy on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Grocy product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including logging in with the default
  credentials and changing them.
- Perform day-2 operations — inspect, update, and manage the persistent `/config`
  volume.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the
  storage-backend gotcha this module's default configuration exists to avoid.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Filestore/NFS,
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

1. In the RAD platform, open **Grocy (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service, mirrors the Grocy container image
   into Artifact Registry, and mounts a Cloud Filestore (NFS) volume at `/config` —
   **not** a GCS bucket; see Task 5 for why. There is no database to provision (Grocy
   uses an embedded SQLite database) and no default initialization job. A first
   deploy takes roughly **10–20 minutes**, dominated by Filestore instance creation
   if no shared NFS server already exists in the project.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~grocy" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is serving. Grocy has no dedicated health endpoint — the
   login page itself (`200`, unauthenticated) is the probe target:

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect: 200 <nonzero size>
   curl -s "$SERVICE_URL/" | grep -o '<title>[^<]*</title>'
   # expect: <title>Login | Grocy</title>
   ```

2. Open `$SERVICE_URL` in a browser. Log in with Grocy's built-in default
   credentials — **`admin` / `admin`** — there is no pre-seeded credential in Secret
   Manager to look up; the upstream image ships this default outright.

3. **Immediately change the admin password.** Go to the user menu → **Manage
   users** → edit `admin` → set a new password. Because `ingress_settings = "all"`
   is the module default (public internet access), leaving the default credentials
   in place on a live deployment is a real exposure.

4. Add one real item — e.g. a product under **Master data → Products**, or a chore
   under **Chores** — and confirm it appears in the relevant list view. This is the
   stateful write that proves the `/config` volume (holding the embedded SQLite
   database) is genuinely writable and durable, not just that the login page
   rendered.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling is intentionally locked to one instance.** Unlike most modules in this
   catalogue, do not raise `max_instance_count` above `1` — Grocy's embedded SQLite
   database is single-writer with no clustering support. There is no Redis or
   equivalent to enable that would make horizontal scaling safe here.

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**; a new image builds (pinned via the
   `GROCY_VERSION` build ARG, not the generic `APP_VERSION`) and a new revision
   rolls out. The persistent `/config` volume is untouched by an image update.

4. **Inspect the persistent `/config` volume** (Filestore/NFS) that holds the
   embedded SQLite database, config, uploads, and backups:

   ```bash
   gcloud filestore instances list --project="$PROJECT" --zone="${REGION}-a"
   ```

5. **Back up `/config` manually if needed** — there is no automated backup job
   specific to Grocy in this module; use the platform's generic `backup_schedule` /
   `enable_backup_import` inputs, or snapshot the Filestore instance directly via
   the Console.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   When verifying storage health specifically, check for the absence of these
   strings (their presence indicates the GCS-FUSE write-pattern failure this
   module's NFS default exists to avoid — see Task 5):
   `OutOfOrderError`, `429`, `stale file`, `database is locked`, `disk I/O error`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency, instance count (should stay at exactly `1`), and CPU /
   memory utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Grocy releases.

- **The storage-backend gotcha this module's defaults exist to prevent.** If you
  ever see repeated `BufferedWriteHandler.OutOfOrderError`, HTTP `429` responses, or
  stale-file-handle errors in the logs together with a crash-restart loop, the most
  likely cause is `/config` having been switched (intentionally or by a
  misconfiguration) back onto GCS FUSE instead of NFS. Grocy's embedded SQLite
  database writes a journal file every 1–2 seconds — a write frequency GCS FUSE's
  object-storage translation layer cannot sustain. Confirm `enable_nfs = true` and
  `nfs_mount_path = "/config"` are both set, and that `enable_gcs_storage_volume` on
  the underlying Common module is `false`.
  ```bash
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --limit=200 | grep -E 'OutOfOrderError|429|stale file|database is locked'
  ```
- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm the NFS mount attached successfully.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login page loads but data doesn't persist across a revision restart:** this
  indicates `/config` is not actually mounted on durable storage — re-check the NFS
  wiring above rather than assuming an application bug.
- **Build failures on deploy or version update:** review Cloud Build history for
  the failed build's log. A stray `container_image_source = "prebuilt"` override in
  `deploy.tfvars` is a known footgun that silently skips the custom Dockerfile
  build entirely — verify the variable is unset or `"custom"`.
- **403 / permission errors:** verify the runtime service account's IAM roles,
  including access to the Filestore instance.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Deleting removes everything the module created — the Cloud Run service,
the Cloud Storage `storage` bucket, and Artifact Registry images. A Filestore (NFS)
instance shared with other applications in the same tenant is **not** removed here;
resources owned by **Services_GCP** (the VPC, shared Filestore, registry) are
managed separately.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, mirrors the container image, mounts `/config` over NFS |
| 2 — Access & verify | Manual | Health check passes; log in with `admin`/`admin`, change the password, write one real item |
| 3 — Operate | Manual | Inspect revisions, update version, confirm scaling stays at 1, inspect/back up the NFS volume |
| 4 — Observe | Manual | Query Cloud Logging (including the storage-failure signature check); review Cloud Monitoring |
| 5 — Troubleshoot | Manual | Diagnose the GCS-FUSE-vs-NFS storage gotcha, revision, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources except the shared Filestore instance |
