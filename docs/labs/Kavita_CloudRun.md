---
title: "Kavita on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Kavita on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Kavita on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Kavita is a fast, self-hosted digital library and reading server for comics,
manga, and e-books — a web reading UI, OPDS feeds, collections, reading lists,
and full-text search, built on .NET with an internal SQLite database. This lab
takes you through the full operational lifecycle of the **Kavita on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Kavita product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete the first-run setup wizard.
- Perform day-2 operations — inspect, scale (or rather, understand why not to), update, and manage storage/backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on — Kavita itself
  needs no Cloud SQL).
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

1. In the RAD platform, open **Kavita (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service and a Cloud Storage bucket
   (mounted at `/kavita/config` via GCS Fuse), builds the custom container image
   (a thin wrapper over `jvmilazz0/kavita`), and starts the service. There is
   **no database to provision and no init job to wait on** — Kavita manages its
   own internal SQLite database. First deploys typically finish in **5–10
   minutes** (dominated by the image build).

3. When it completes, discover the resource with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~kavita" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Kavita exposes a public, unauthenticated
   health endpoint that returns `200` once the server is serving:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Kavita's **first-run setup
   wizard** walks through creating the initial administrator account and adding
   your first library — there is no pre-seeded admin credential in Secret
   Manager. Complete this promptly: until the wizard runs, the service is
   reachable but unclaimed, and anyone who reaches the URL first can create the
   admin account.

3. This module only persists Kavita's **state** directory (`/kavita/config` —
   settings, the SQLite database, covers). It does not provision the actual
   library content. To read anything, add your own `gcs_volumes` (or an NFS
   mount) pointing at your comics/manga/e-book files and register that path as
   a library inside the Kavita UI.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count` defaults to `1`
   (unlike most modules, which default to scale-to-zero — this avoids
   cold-start delays while gcsfuse re-mounts and Kavita reloads its library
   index) and `max_instance_count` is pinned to `1`. Kavita has no clustering or
   shared-write coordination, so a second instance writing the same
   gcsfuse-mounted SQLite file risks corrupting the library index — leave
   `max_instance_count` at `1`.

3. **Be aware of the storage layer.** Cloud Run has no block Persistent Volume
   option, so `/kavita/config` (the SQLite database and settings) is always
   mounted through GCS Fuse here — the one place in this module where the
   repository's usual "gcsfuse corrupts SQLite" caution is unavoidable rather
   than a misconfiguration. This module is best suited to light-to-medium
   libraries; for large libraries or heavy metadata scans, prefer
   [Kavita_GKE](https://docs.radmodules.dev/docs/modules/Kavita_GKE), whose
   default block PVC is the safer, lower-latency option.

4. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new
   revision rolls out. Note `application_version = "latest"` resolves to a
   pinned `KAVITA_VERSION = 0.8.7` build argument inside `Kavita_Common`, not
   the generic tag the Foundation injects — bumping the version requires
   editing that pinned value and rebuilding, not just redeploying.

5. **Inspect and back up storage:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~kavita"
   gcloud storage ls gs://<config-bucket>/          # bucket name is in the Outputs
   ```

   Backups run on the module's `backup_schedule` (default `0 2 * * *` UTC) and
   restore the whole `/kavita/config` directory — Kavita has no separate
   database dump, since its state is the config directory itself.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count, and CPU / memory
   utilisation. An optional **uptime check** against `/api/health` can be
   enabled (`uptime_check_config`, disabled by default); if enabled, confirm it
   is green under Monitoring → Uptime checks and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Kavita releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors. The startup probe targets `/api/health` with a
  generous failure budget (10 attempts) to tolerate first-boot library
  indexing before the liveness probe takes over.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Service reachable but library/data missing after a redeploy:** confirm the
  `storage` bucket is still mounted at `/kavita/config` and that no one
  accidentally pointed the module at a different bucket — this directory is
  the entirety of Kavita's durable state.
- **Slow response times or occasional errors under load:** this is the
  expected trade-off of GCS Fuse-backed SQLite on a light/medium library; if
  it persists, consider migrating to
  [Kavita_GKE](https://docs.radmodules.dev/docs/modules/Kavita_GKE) for its
  block-PVC-backed storage.
- **OPDS or mobile reader app can't connect:** confirm `enable_iap = false`
  (the default) — Kavita's OPDS feed and mobile reader-app clients typically
  cannot complete Google IAP's auth flow — and that `ingress_settings = "all"`.
- **Image build failed:** review Cloud Build history for the failed build's
  log; a common cause is an edited `KAVITA_VERSION` pointing at a tag that
  does not exist upstream.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including why `max_instance_count` must stay at `1`
and why `enable_redis`/`enable_cloudsql_volume` are inert for this module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service
and the Cloud Storage bucket holding Kavita's entire state (SQLite database,
settings, covers, backups). Resources owned by **Services_GCP** (the VPC,
Artifact Registry) are managed separately and are not removed here. Because
that bucket **is** the library index and reading progress, make sure you have a
backup or export you care about before deleting.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run and the GCS Fuse-mounted config bucket; no database, no init job |
| 2 — Access & verify | Manual | Health check passes; complete the first-run setup wizard to create the admin account and first library |
| 3 — Operate | Manual | Inspect revisions, keep `max_instance_count = 1`, update version, manage storage/backups |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, storage, OPDS/IAP, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the bucket holding Kavita's entire state |
