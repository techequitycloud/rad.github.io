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
- Confirm how the default NFS mount achieves upload/plugin/theme persistence on
  Cloud Run, and know the residual caveats around it.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL, Artifact Registry, and shared
  service accounts this module depends on). You do not need to deploy this
  yourself first — the platform automatically detects whether it already exists
  in the target project and provisions it before this module if not (see Task
  1).
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
   on the next apply). Keep `max_instance_count = 1`: `wp-content` (uploads, plugins,
   themes) is shared across instances via the NFS mount, but ClassicPress's core
   files outside `wp-content` are copied independently by each instance on boot, and
   concurrent-write safety on the shared `wp-content` mount across multiple replicas
   has not been validated for this module.

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

6. **Uploaded media, plugins, and themes persist across cold starts by default.**
   This module defaults to `min_instance_count = 0` (scale-to-zero) and
   `enable_nfs = true`, which mounts Filestore at `/var/www/html/wp-content` — the
   directory where ClassicPress (a WordPress fork) reads and writes uploaded media,
   installed plugins, and themes. The upstream entrypoint's first-boot copy logic
   explicitly skips an existing `wp-content` directory rather than overwriting it,
   so mounting NFS there is what keeps that content durable across instance churn
   (idle timeout, redeploy, instance replacement). Only the ClassicPress *core*
   files outside `wp-content` are freshly copied into `/var/www/html` on each cold
   start — expected, since those files ship with the image and need no persistence.
   You can confirm this yourself: upload a media file, trigger a cold start (wait
   past the idle timeout, or force a new revision), and verify the file is still
   present.

   Two residual caveats worth knowing:

   - **The two GCS buckets the module provisions (`data` and `classicpress-uploads`)
     are not wired in as a `gcs_volumes` mount by default.** They exist but are
     unused unless you add a `gcs_volumes` entry — NFS is the persistence path that
     is actually active out of the box, not these buckets.
   - **`max_instance_count` stays at `1` by default.** `wp-content` is shared across
     instances via NFS, but concurrent-write safety across multiple simultaneous
     replicas writing to that shared mount has not been validated for this module —
     see item 2 above.

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

- **Uploaded files or installed plugins appear to disappear after an idle
  period:** with the default `enable_nfs = true`, `wp-content` (uploads, plugins,
  themes) is mounted on Filestore at `/var/www/html/wp-content` and should survive
  scale-to-zero cold starts — the upstream entrypoint's copy logic skips that
  directory rather than overwriting it. If content genuinely disappears, first
  confirm `enable_nfs` wasn't disabled and that the Filestore instance is
  `READY` (`gcloud filestore instances list --project="$PROJECT"`) rather than
  assuming persistence is broken by design. Compare `wp-content/uploads` file counts
  before and after an idle period long enough to trigger scale-to-zero, or check
  that revision/instance identity changed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  ```
- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is TCP on port 80 with a generous `failure_threshold = 20`, giving the
  upstream entrypoint time to populate `/var/www/html` on first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Site stuck on the first-run installer after you thought you'd completed it:**
  `wp-config.php` and the ClassicPress core files are recreated fresh on every
  cold start (expected — they ship with the image), while the database and
  `wp-content` (via NFS) persist. If the installer appears to run again, check that
  the database schema was actually written on the prior attempt — `db-init` only
  creates the empty database and user; the installer itself must complete
  successfully to create the schema and admin account. Re-running the installer
  against an already-populated database is not safe; verify the schema state first
  with `gcloud sql connect` before retrying.
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
NFS-backed persistence mechanism above).

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
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access; confirm NFS-backed upload/plugin/theme persistence across cold starts |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues; verify NFS-backed uploads/plugins persistence across cold starts |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
