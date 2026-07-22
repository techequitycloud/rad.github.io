---
title: "Linkwarden on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Linkwarden on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Linkwarden on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Linkwarden is an open-source, self-hosted bookmark manager with full-page
archiving (screenshot, PDF, and single-file "monolith" snapshots via a bundled
headless Chrome). This lab takes you through the full operational lifecycle of
the **Linkwarden on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Linkwarden product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud
  SQL, Artifact Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Linkwarden (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`NEXTAUTH_SECRET` and the
   database password), a Cloud Storage bucket mounted at `/data/data` for
   archived content, builds the custom container image (a thin wrapper around
   `ghcr.io/linkwarden/linkwarden`), and runs a one-shot database
   initialisation job. First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~linkwarden" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is reachable (Linkwarden has no confirmed dedicated
   health endpoint, so the root page is the best signal):

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL"
   # expect 200 and a non-trivial byte size (a rendered page, not an empty body)
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Linkwarden shows the
   registration page — no pre-seeded admin credential exists in Secret
   Manager. Register the first account; it automatically becomes the
   instance owner.

3. **Verify archiving end-to-end (the real stateful test).** Log in, add a
   bookmark (any public URL), and wait 10–30 seconds for the background
   archiving worker to process it. Refresh the link's detail view and confirm
   a screenshot/preview has been generated — this proves the DB write, the
   background worker, headless Chrome, and the GCS-backed storage mount are
   all correctly wired. If archiving never completes, see Task 5.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an
   immutable revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the service spec, so
   scaling is a configuration change, not a manual `gcloud` edit (a manual
   edit would be reverted on the next apply). Keep `min_instance_count >= 1`
   — the in-container background archiving worker needs to keep running
   between requests.

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new image builds and a
   new revision rolls out. Linkwarden publishes a genuine `latest` tag
   upstream, so `latest` tracks the real upstream release (unlike some other
   custom-build modules in this catalogue that pin a stale version).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~linkwarden"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=linkwarden --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation — watch for memory spikes during
   archive-worker batches (concurrent headless Chrome instances). The module
   can provision an **uptime check** (when `uptime_check_config.enabled =
   true` — it defaults to `false`); if enabled, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Linkwarden releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets resolved.
  The startup probe targets `/` and allows a generous window on first boot
  for Next.js cold start plus headless Chrome initialization.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the initialisation job
  completed successfully. Linkwarden's `DATABASE_URL` connects over the raw
  Cloud SQL private IP (`DB_IP`) on Cloud Run with `sslmode=require` — never
  the Unix-socket path (Prisma's URL-authority DSN parsing breaks on the
  socket directory's colons).
- **Archiving never completes / links stay un-previewed:** first confirm the
  service itself is healthy (Task 2, step 1). If it is, this is very likely
  the documented Cloud Run gVisor-sandbox risk with the bundled headless
  Chrome — check the container logs for a Chrome/Playwright launch failure.
  As a fallback, set `disable_browser = true` (skips all browser-dependent
  archiving; metadata/tag/collection features keep working) and confirm
  whether that resolves the crash-loop — if so, this is a platform
  sandbox incompatibility, not a configuration error.
- **Initialisation job failed:** list executions and read the failed one's
  logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's
  log.
- **403 / permission errors:** verify the runtime service account's IAM
  roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`NEXTAUTH_SECRET` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). Delete removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS
buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, GCS storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Service responds; register the first account (becomes owner); confirm archiving completes end-to-end |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, archiving/Chrome-sandbox, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
