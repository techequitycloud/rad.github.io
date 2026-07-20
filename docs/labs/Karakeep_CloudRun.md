---
title: "Karakeep on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Karakeep on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Karakeep on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Karakeep is an open-source, self-hostable bookmark-everything app with
AI-based automatic tagging and full-text search. This lab takes you through the
full operational lifecycle of the **Karakeep on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Karakeep product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions,
  including the required Meilisearch search sidecar.
- Access and verify the running service, and create the first (admin) account.
- Perform day-2 operations — inspect, scale limitations, update, and manage backups.
- Observe the service and its search sidecar with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  a degraded-but-running search sidecar.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, NFS/Filestore,
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

1. In the RAD platform, open **Karakeep (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, the required internal-only
   **Meilisearch** search sidecar as a second Cloud Run service, the two
   application secrets (`NEXTAUTH_SECRET`, `MEILI_MASTER_KEY`), and mounts the
   shared NFS volume for both. There is no Cloud SQL step — first deploys are
   noticeably faster than database-backed modules, typically **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~karakeep AND NOT metadata.name~meilisearch" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   MEILI_SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~meilisearch" --format="value(metadata.name)" --limit=1)
   echo "Meilisearch sidecar: $MEILI_SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving:

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Open `$SERVICE_URL` in a browser. Karakeep shows its sign-up/login page.
   **Create the first account** — there is no pre-seeded admin credential;
   whoever registers first automatically becomes the admin. After creating it,
   save a bookmark (any URL) to confirm the SQLite-over-NFS write path works —
   the bookmark should appear in your library and remain there after a page
   refresh. Optionally search for it by a keyword in its title to confirm the
   Meilisearch sidecar is reachable and indexing.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not raise `max_instance_count` above 1.** Unlike most modules in this
   catalogue, Karakeep's `max_instance_count` is pinned by design — multiple
   Cloud Run instances writing the same SQLite file over NFS risks corruption.
   There is no supported way to scale Karakeep horizontally in this module.

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new revision rolls out (no
   rebuild — the image is pulled directly from `ghcr.io/karakeep-app/karakeep`).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~karakeep"
   ```

5. **Inspect the Meilisearch sidecar independently:**

   ```bash
   gcloud run services describe "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run services logs read "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — the main app and the search sidecar log independently:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$MEILI_SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Monitoring** — open the Cloud Run dashboard for both services and review
   request count, latency, instance count, and CPU/memory utilisation
   independently — a healthy main app with a struggling sidecar looks fine on
   the main app's own dashboard, so check both.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs. The startup probe targets `/` with a 30-second initial delay.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **App loads but search returns nothing:** the Meilisearch sidecar is likely
  down or `MEILI_ADDR` failed to inject. Check the sidecar's own revision status
  and logs (see Task 3, step 5) — bookmarking still works in this state, which
  makes it an easy-to-miss degraded mode rather than an outage.
- **Bookmarks don't persist / SQLite errors in logs:** confirm the NFS volume
  mounted successfully (`enable_nfs = true`) and that no second instance is
  concurrently writing (`max_instance_count` should read `1`).
- **Image build/pull failed:** Karakeep uses a prebuilt image
  (`ghcr.io/karakeep-app/karakeep`) — a failure here is almost always a bad
  `application_version` tag rather than a Cloud Build issue, since no build runs.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `max_instance_count` is pinned and the Meilisearch
degraded-mode behaviour).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it, use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources. This
removes everything the module created — both Cloud Run services (main app and
Meilisearch sidecar), Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared NFS, registry) are managed
separately and are not removed here. Note that deleting the deployment does
**not** clear the NFS-persisted bookmark data unless the NFS volume itself is
also torn down at the `Services_GCP` layer.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (main app + Meilisearch sidecar), NFS mount, and two secrets |
| 2 — Access & verify | Manual | Health check passes; create the first (admin) account and save/search a bookmark |
| 3 — Operate | Manual | Inspect revisions, update version, manage secrets, inspect sidecar independently |
| 4 — Observe | Manual | Query Cloud Logging for both services; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose revision, NFS, sidecar, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes both services and secrets |
