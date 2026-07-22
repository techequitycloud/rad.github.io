---
title: "Healthchecks on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Healthchecks on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Healthchecks on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Healthchecks is an open-source, self-hosted cron job and heartbeat monitoring
service: scheduled tasks "ping" it on success, and it alerts you when a ping is
late or missing. This lab takes you through the full operational lifecycle of
the **Healthchecks on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Healthchecks product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and log in with the seeded admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL
  networking, Artifact Registry, and shared service accounts this module
  depends on).
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

1. In the RAD platform, open **Healthchecks (Cloud Run)**, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY`, `ADMIN_PASSWORD`,
   and the database password), and runs two one-shot jobs: `db-init` (creates
   the database and role) and `admin-bootstrap` (runs migrations and seeds the
   initial superuser account). First deploys take roughly **15–25 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~healthchecks" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up and serving the login page (Healthchecks has no
   dedicated health endpoint — the root page is the public, unauthenticated
   signal):

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect 200 (or a redirect in the 300 range) and a non-zero body size
   ```

2. Retrieve the seeded admin credential and log in:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~healthchecks-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Open `$SERVICE_URL` in a browser, sign in with `admin_email` (default
   `admin@techequity.cloud`, or whatever value you configured) and the password
   above. You should land on the empty checks dashboard.

3. Create a test check from the UI (or via the API) and confirm it appears in
   the dashboard — this proves the database write path is working end-to-end,
   not just that the login page rendered.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale to zero carelessly.** This module defaults to
   `min_instance_count = 1` and `cpu_always_allocated = true` specifically so
   the co-located `sendalerts`/`sendreports` background loop keeps noticing
   missed check-ins. If you scale to `min_instance_count = 0` or flip
   `cpu_always_allocated = false` to save cost, understand that alerting may
   become unreliable while the service is idle.

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new revision rolls out
   using the same official `healthchecks/healthchecks` image at the new tag.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~healthchecks"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + admin-bootstrap
   ```

5. **Configure real outbound email** (required for alerts to actually be
   delivered — the default `DEFAULT_FROM_EMAIL` is a placeholder): set
   `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` via `environment_variables`
   and `EMAIL_HOST_PASSWORD` via `secret_environment_variables`, then apply.

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=healthchecks_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The same log stream carries
   both the web server AND the `sendalerts`/`sendreports` background workers
   (they run in the same container):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count, and CPU/memory
   utilisation. Since this service defaults to always-on (`min_instance_count
   = 1`), expect steady low-level CPU usage from the background alert loop
   even with zero HTTP traffic. The module can provision an **uptime check**
   (when `uptime_check_config.enabled = true` — it defaults to `false`); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Healthchecks releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets resolved.
  The startup probe targets `/` with a 60-second initial delay.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed
  successfully.
- **Login page loads but the app seems to be using SQLite / data resets on
  restart:** confirm the `DB` env var actually resolved to `"postgres"` on the
  running revision — this is the single most important setting to verify.
  ```bash
  gcloud run revisions describe <revision-name> --project="$PROJECT" --region="$REGION" \
    --format=json | grep -A2 '"name": "DB"'
  ```
- **Can't log in with the seeded credential:** confirm the `admin-bootstrap`
  job actually completed (it depends on `db-init` finishing first):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Alerts never arrive:** this is very likely a missing/placeholder SMTP
  configuration (`DEFAULT_FROM_EMAIL`/`EMAIL_HOST`), not a platform bug — check
  the service logs for SMTP connection errors from `sendalerts`.
- **Image build failed:** this module deploys the official prebuilt image with
  `container_image_source = "prebuilt"` — there should be no build step at
  all. If you see a Cloud Build failure, check whether `container_image_source`
  was accidentally overridden to `"custom"`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, and Secret Manager secrets.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs `db-init` + `admin-bootstrap` |
| 2 — Access & verify | Manual | Login page loads; sign in with the seeded admin credential; create a test check |
| 3 — Operate | Manual | Inspect revisions, update version, manage secrets, configure SMTP, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database engine, admin-bootstrap, and SMTP issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
