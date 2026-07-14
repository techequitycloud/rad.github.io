---
title: "ClassicPress on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy ClassicPress on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ClassicPress on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

ClassicPress is a free, open-source, business-focused CMS — a lightweight fork of
WordPress 4.9.x that preserves the classic (pre-Gutenberg) editing experience, with
plugins, themes, a media library, and a REST API. This lab takes you through the full
operational lifecycle of the **ClassicPress on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on ClassicPress product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the running service and complete the first-run ClassicPress installer.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Recognise and work around the confirmed media-persistence limitation on Cloud Run.
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

1. In the RAD platform, open **ClassicPress (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin custom image (`FROM classicpress/classicpress`) via
   Cloud Build, provisions the Cloud Run service, a Cloud SQL for MySQL 8.0 database
   with its Secret Manager secrets (`CLASSICPRESS_SALT_SEED` and the database
   password), a Filestore (NFS) instance (`enable_nfs = true` by default), two Cloud
   Storage buckets (`data` and `classicpress-uploads`), and runs a one-shot
   database-initialisation job (`db-init`) that creates the application database and
   user. First deploys take roughly **15–30 minutes** (Cloud SQL and Filestore
   creation dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~classicpress" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. ClassicPress has no dedicated health endpoint before
   installation, so a simple reachability check is the right first probe:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   # expect 200 (already installed) or 302 (redirect to the first-run installer)
   ```

2. Open `$SERVICE_URL` in a browser. On a fresh database, ClassicPress redirects to
   `/wp-admin/install.php` — complete the installer (site title, admin username,
   password, and email) to create the schema and the admin account. There is
   **no pre-seeded admin credential** in Secret Manager; the installer is the only
   way to set one.

3. Log in at `$SERVICE_URL/wp-login.php` with the account you just created and
   confirm the dashboard loads.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). Keep `max_instance_count = 1`: the ClassicPress install lives
   on the container's own filesystem, which is per-instance and not shared, so a
   second concurrent instance would run its own diverging copy of the site.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~classicpress"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=classicpress --project="$PROJECT"
   ```

6. **Known limitation — uploaded media and plugins do not survive a cold start.**
   This module defaults to `min_instance_count = 0` (scale-to-zero), but neither the
   `ClassicPress_Common` Dockerfile nor its `entrypoint.sh` ever mount storage under
   `/var/www/html` — the directory where ClassicPress's own entrypoint writes
   `wp-config.php` and copies the whole application, including `wp-content/uploads`
   and any plugin/theme installed through wp-admin. `enable_nfs = true` is on by
   default, but it mounts Filestore at `/var/lib/classicpress`, a path the image
   never reads or writes. The two GCS buckets the module provisions
   (`data` and `classicpress-uploads`) are likewise not wired in as a `gcs_volumes`
   mount out of the box. **Practical effect:** every time the service scales to zero
   and a new instance cold-starts (idle timeout, redeploy, instance replacement),
   `/var/www/html` starts empty again — uploaded media and admin-installed
   plugins/themes from the previous instance are gone. The Cloud SQL database
   (pages, posts, settings, and the media *metadata rows*) is unaffected and
   survives. This is confirmed by direct inspection of the Dockerfile and
   entrypoint, not a theoretical risk.

   Two practical workarounds, in order of effort:

   - **Set `min_instance_count = 1`.** This keeps one instance warm permanently, so
     `/var/www/html` is never re-initialised from empty during normal operation
     (it still resets on every redeploy/version update, since that always creates a
     fresh instance). This is the quickest fix and is recommended for any real use
     of ClassicPress's media library or plugin installs.
   - **Add a `gcs_volumes` mount** at `/var/www/html/wp-content/uploads` pointing at
     the `classicpress-uploads` bucket, so uploads specifically survive instance
     churn (this does not cover plugins/themes installed elsewhere under
     `/var/www/html`).
   - **Use [ClassicPress_GKE](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE)
     instead** if you need the whole install (code, plugins, themes, uploads) to
     persist by default — the GKE variant mounts a StatefulSet block PVC at
     `/var/www/html` at the Application-module level, which is unaffected by this
     Common-layer gap because the PVC happens to cover the exact directory the
     entrypoint populates.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. `uptime_check_config` is disabled (`enabled = false`) by
   default for this module — enable it in the platform if you want a Monitoring
   uptime check and check-failure alert wired up.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ClassicPress releases.

- **Uploaded files or installed plugins disappearing after an idle period (KNOWN
  BUG):** this is the confirmed `/var/www/html` persistence gap described in
  Task 3 — `enable_nfs = true` is the default but mounts Filestore at
  `/var/lib/classicpress`, a path the image never touches, so scale-to-zero
  (`min_instance_count = 0`, the default) silently wipes media/plugins on the next
  cold start while the database (posts, settings, metadata) stays intact. Confirm by
  comparing `wp-content/uploads` file counts before and after an idle period long
  enough to trigger scale-to-zero, or by checking that revision/instance identity
  changed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  ```
  Fix: set `min_instance_count = 1`, add a `gcs_volumes` mount for
  `wp-content/uploads`, or move to `ClassicPress_GKE` (StatefulSet PVC at
  `/var/www/html`). This is not a misconfiguration you can "fix" by changing an env
  var — it is a gap in the current Common-layer entrypoint.
- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is TCP on port 80 with a generous `failure_threshold = 20`, giving the
  upstream entrypoint time to populate `/var/www/html` on first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Site stuck on the first-run installer after you thought you'd completed it:**
  this is the same underlying bug — if the instance that ran the installer was
  never made durable (see Task 3), a fresh cold-started instance's `wp-config.php`
  is gone even though the database schema it created is still there; ClassicPress
  falls back to a confusing partial state. Re-running the installer against an
  already-populated database is not safe — apply the `min_instance_count = 1`
  workaround first, then redo the install cleanly.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the `db-init` job completed successfully. MySQL is reached over private-IP TCP by
  default (`enable_cloudsql_volume = false`); no SSL configuration is required.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rule never to rotate
`CLASSICPRESS_SALT_SEED` after first boot, and the full detail behind the
media-persistence bug above).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, Filestore instance, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), Filestore, secrets, storage buckets, and runs `db-init` |
| 2 — Access & verify | Manual | Reachability check passes; complete the first-run installer to create the admin account |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access; understand the media-persistence bug and its workarounds |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues; recognise the confirmed uploads/plugins cold-start data-loss bug |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
