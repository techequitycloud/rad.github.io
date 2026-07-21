---
title: "Wallabag on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Wallabag on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Wallabag on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Wallabag is an open-source, self-hosted "read it later" article archiving app —
save articles from a browser extension, bookmarklet, mobile app, or the REST API,
and read them later in a clean, distraction-free view with full-text search and
tagging. This lab takes you through the full operational lifecycle of the
**Wallabag on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Wallabag product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and log in with the default administrator account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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

1. In the RAD platform, open **Wallabag (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager secrets (`APP_SECRET` and the database password), a
   generic Cloud Storage bucket, builds the custom container image, and runs the
   two-stage initialization chain: `db-init` (creates the database/user/grants)
   followed by `wallabag-install` (Wallabag's own installer, which creates the
   schema and seeds the default administrator account in one step). First deploys
   take roughly **15–25 minutes** (Cloud SQL creation and the image build
   dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~wallabag" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Wallabag redirects an unauthenticated request
   to the root path to its login page — expect **HTTP 302**, not 200:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
   ```

2. Open `$SERVICE_URL` in a browser. Log in with Wallabag's documented default
   administrator credentials — **username `wallabag`, password `wallabag`** —
   seeded by the `wallabag-install` init job. **Change this password
   immediately** (top-right menu → your account → change password). Self-service
   sign-up is disabled by default, so this is the only account until you create
   more from the admin UI.

3. Save a test article to confirm end-to-end write/read against the real
   database: paste any article URL into the "Save a new entry" box and confirm
   it appears in your list with its title and content fetched. Reload the page
   (or, better, redeploy — see Task 3) and confirm the saved article is still
   there — this is the surest sign the app is actually writing to Cloud SQL and
   not to a throwaway local file (see the Troubleshoot section for why that
   distinction matters).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing `application_version` in the
   RAD platform and applying it via **Update**; a new image builds `FROM
   wallabag/wallabag:<version>` and a new revision rolls out. `wallabag-install`
   re-runs safely against the existing schema (it is idempotent) — no manual
   migration step is needed.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~wallabag"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=wallabag --project="$PROJECT"
   ```

6. **Set up the browser extension / mobile app / API access.** With the admin
   account logged in, go to your account settings to view your API client
   credentials, or generate a new API client under Developer → My applications.
   Use `$SERVICE_URL` as the server address when configuring the official
   Firefox/Chrome extension or a mobile client (wallabag Android/iOS, or any
   Pocket-compatible client that supports a custom server).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and CPU /
   memory utilisation. The module can provision an **uptime check**; if enabled,
   confirm it is green under Monitoring → Uptime checks, and review Alerting →
   Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Wallabag releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe is TCP on port 80 (only needs nginx to bind); a 302 from the
  liveness probe's `GET /` is expected and healthy.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Articles vanish after a redeploy — the #1 thing to check on this module.**
  This is the signature symptom of Wallabag silently installing against a
  local SQLite file instead of MySQL: the app boots, the health checks pass,
  articles save and appear to work, but everything disappears on the next
  container restart. This happens if `SYMFONY__ENV__DATABASE_DRIVER` is ever
  unset or overridden — it must explicitly be `pdo_mysql` (the shipped
  `entrypoint.sh` sets this; do not add a conflicting `SYMFONY__ENV__DATABASE_DRIVER`
  via `environment_variables`). See the Configuration Guide's *Configuration
  Pitfalls* section for the full explanation — there is no error message for
  this failure, only the vanished data.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` job completed successfully
  before `wallabag-install` ran.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-wallabag-install" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.
- **Can't log in with `wallabag` / `wallabag`:** if the password was already
  changed by a previous operator, use `gcloud sql connect` (Task 3) or the
  install job's logs to confirm `wallabag-install` actually ran; a fresh
  deployment always seeds the default credentials on first successful install.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas — especially the critical `SYMFONY__ENV__DATABASE_DRIVER`
rule above.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs the `db-init` → `wallabag-install` init chain |
| 2 — Access & verify | Manual | Health check returns 302 to `/login`; log in with default `wallabag`/`wallabag`; save a test article |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access, extension/API setup |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, and build issues — including the silent-SQLite-fallback symptom |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
