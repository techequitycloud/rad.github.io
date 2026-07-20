---
title: "Radicale on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Radicale on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Radicale on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Radicale is an open-source, self-hosted CalDAV/CardDAV server for calendar
and contacts sync. This lab takes you through the full operational lifecycle
of the **Radicale on Cloud Run** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Radicale product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, retrieve the generated admin credential, and connect a CalDAV/CardDAV client.
- Understand why Cloud Run cannot create NEW collections via a standard client, and where the pre-seeded defaults come from.
- Perform day-2 operations — inspect, scale, and update.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC,
  Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- (Optional) A CalDAV/CardDAV client to verify end-to-end sync — e.g. Thunderbird, Apple Calendar/Contacts, or DAVx5.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Radicale (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_CloudRun)
   documents every input by group, with defaults. **Set
   `application_display_name = "Radicale"` explicitly** — the module's
   default currently carries a stale value inherited from its clone source
   (see the Configuration Guide's Pitfalls section). Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a `storage` GCS bucket
   mounted at `/var/lib/radicale`, a Secret Manager secret holding a
   generated `ADMIN_PASSWORD`, and runs the `seed-default-collections`
   initialization job that writes a default calendar and address book onto
   the storage volume. First deploys typically take **5–10 minutes** — much
   faster than database-backed modules, since there is no Cloud SQL instance
   to provision.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~radicale" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving (expect a `302` redirect to
   the web UI, since `/` is unauthenticated by design):

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code}\n'   # expect 302
   ```

2. Radicale ships with **no built-in default admin account** — retrieve the
   generated credential from Secret Manager:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~radicale-admin-password" \
     --format="value(name)" --limit=1)
   ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Username: admin"
   echo "Password: $ADMIN_PASSWORD"
   ```

3. Confirm authenticated access works with a `PROPFIND` against the admin's
   principal (expect `207 Multi-Status`):

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X PROPFIND "$SERVICE_URL/admin/" \
     -H "Depth: 1" -o /dev/null -w '%{http_code}\n'
   ```

4. Connect a CalDAV/CardDAV client (Thunderbird, Apple Calendar, DAVx5) to
   `$SERVICE_URL/admin/` using the `admin` username and the retrieved
   password. You should see the pre-seeded **Default Calendar** and
   **Default Address Book** — these were created automatically by the
   `seed-default-collections` job at deploy time (see Task 5 for why this
   job exists).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** — `max_instance_count` is pinned to `1` and should **not** be
   raised: Radicale's storage backend is not designed for concurrent
   multi-instance access. `min_instance_count` can be raised to `1` via the
   RAD platform's **Update** flow if you want to avoid cold starts, at the
   cost of an always-on instance.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Remember: Radicale's container registry tags have **no `v` prefix**
   (e.g. `3.7.7`, not `v3.7.7`).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~radicale"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Inspect the storage bucket** holding every collection:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~radicale" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/collections/collection-root/admin/"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, latency, instance count, and CPU/memory utilisation. The
   module can provision an **uptime check** (disabled by default); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs. The startup probe targets `/`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`seed-default-collections` job failed, or no default calendar shows up:**
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-seed-default-collections" --project="$PROJECT" --region="$REGION"
  ```
  Confirm the `storage` GCS bucket exists and the job's execution succeeded.

- **A CalDAV/CardDAV client (or Radicale's own web UI) fails to create a NEW
  calendar with a generic error, "Bad Request", or similar.** This is
  **expected behaviour on Cloud Run, not a bug in your client.** Creating a
  new collection requires the WebDAV `MKCOL` method, and Google's Cloud Run
  frontend (GFE) rejects `MKCOL` at the edge — the request never reaches the
  Radicale container. Confirm with:
  ```bash
  curl -s -u "admin:$ADMIN_PASSWORD" -X MKCOL "$SERVICE_URL/admin/a-new-calendar/" -o /dev/null -w '%{http_code}\n'
  # expect a Google frontend error (400), NOT a Radicale response
  ```
  You cannot work around this from the client side, and Cloud Run has no
  shell access for a manual fix. Use the pre-seeded Default Calendar/Address
  Book, add a custom `initialization_jobs` entry to seed more collections at
  deploy time, or switch to `Radicale_GKE`, whose LoadBalancer Service has
  no such restriction.

- **401 Unauthorized on every request, even with the right-looking
  credential:** double-check you retrieved the *current* `ADMIN_PASSWORD`
  from Secret Manager — the value regenerates only when the secret itself
  changes, but a stale, manually-copied password will not match. Also
  confirm you're using `admin` (or your configured `ADMIN_USERNAME`), not an
  email address — Radicale's htpasswd auth expects a plain username.

- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use
**Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. This removes everything the module created —
the Cloud Run service, the `storage` GCS bucket (and every calendar/address
book it held), Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, a GCS storage bucket, a generated admin secret, and runs the default-collection seed job |
| 2 — Access & verify | Manual | 302 on `/`; retrieve the generated admin password; connect a CalDAV/CardDAV client and see the seeded defaults |
| 3 — Operate | Manual | Inspect revisions, understand the `max=1` scaling limit, update version, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, seed-job, MKCOL/Cloud-Run-edge, and auth issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including every stored collection |
