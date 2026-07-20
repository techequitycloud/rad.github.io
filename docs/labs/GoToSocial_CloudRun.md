---
title: "GoToSocial on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy GoToSocial on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# GoToSocial on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

GoToSocial is a lightweight, self-hosted ActivityPub/Fediverse server — a
small alternative to Mastodon, written as a single static Go binary. This lab
takes you through the full operational lifecycle of the **GoToSocial on
Cloud Run** module on Google Cloud: deploy it, access and verify it (including
creating its first admin account, which requires a manual step), run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on GoToSocial product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, correctly (with a `User-Agent` header),
  and create the instance's first admin account via the required manual job trigger.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  a stuck admin-account creation.
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

1. In the RAD platform, open **GoToSocial (Cloud Run)**, set `project_id`, and
   set **`host`** to your real domain if you have one (this value is baked
   into every ActivityPub URI at creation time and is **immutable** once real
   accounts/posts exist — the placeholder `gotosocial.local` is fine for this
   lab). Review the other inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15,
   created with the mandatory `C` collation) database with its Secret Manager
   secrets (`SUPERUSER_PASSWORD`, an HMAC key pair for S3-compatible object
   storage, and the database password), a Cloud Storage `storage` bucket, and
   runs the `db-init` initialization job. First deploys take roughly
   **15–25 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gotosocial" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Confirm the service is up — but you must send a `User-Agent` header, or
   GoToSocial will reject the request.** GoToSocial's health endpoints
   (`/readyz`, `/livez`) are real and unauthenticated, but they deliberately
   reject any request lacking a `User-Agent` with a `418 I'm a teapot`
   response — this is an anti-scraper measure, not a bug:

   ```bash
   curl -s "$SERVICE_URL/readyz"                         # 418 — no User-Agent sent
   curl -A "gotosocial-lab-check/1.0" -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/readyz"   # expect 200
   ```

2. **Create the instance's first admin account — this is a REQUIRED manual
   step, not an optional one.** GoToSocial has no web-based sign-up flow and
   no REST endpoint for the very first account; it is CLI-only, and the CLI
   refuses to run until the main server has completed its first boot. The
   `admin-create` job is deliberately **not** auto-executed on Cloud Run
   (initialization jobs always run before the service's first revision
   exists), so trigger it now that the service is confirmed healthy:

   ```bash
   gcloud run jobs execute "${SERVICE}-admin-create" --project="$PROJECT" --region="$REGION" --wait
   ```

   If it fails because the server hadn't finished booting yet, wait a minute
   and re-run the same command — the job's own script also retries
   internally (20 attempts, 15s apart) before giving up.

3. **Retrieve the generated `SUPERUSER_PASSWORD` from Secret Manager:**

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Log in to the instance with the default `admin` username (or whatever
   `superuser_username` was set to) and the retrieved password, using any
   ActivityPub/GoToSocial-compatible client, or verify the client API
   directly:

   ```bash
   curl -A "gotosocial-lab-check/1.0" -s "$SERVICE_URL/api/v1/instance" | head -c 500
   ```

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
   edit would be reverted on the next apply). GoToSocial defaults to
   `min_instance_count = 0` (scale-to-zero) and `max_instance_count = 1` —
   **do not raise `max_instance_count`**: GoToSocial's in-process cache has
   no cross-instance synchronization, and upstream does not support multiple
   instances against the same database/storage.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new revision pulls the
   updated `docker.io/superseriousbusiness/gotosocial` tag. Schema migrations
   run automatically on the new revision's boot — there is no separate
   migrate job to run.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gotosocial"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, admin-create jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=gotosocial --project="$PROJECT"
   ```

6. **Verify object storage is being used** (media/avatars/attachments go
   straight to GCS via GoToSocial's native S3 client, not a filesystem mount):

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
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
   behaviour — should sit at 0 between test requests since `min_instance_count
   = 0` by default), and CPU/memory utilisation. GoToSocial's
   `uptime_check_config` is disabled by default; if you enable it, be aware
   a plain `/` uptime check (not `/readyz`/`/livez`) avoids the
   User-Agent-gate false-positive-failure risk unless the checker sends a
   `User-Agent`.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with GoToSocial releases.

- **Health checks/curl return `418 I'm a teapot`:** this is expected —
  GoToSocial rejects any request without a `User-Agent` header as an
  anti-scraper measure, even against its "unauthenticated" `/readyz`/`/livez`
  endpoints. Always pass `curl -A "<some-agent>" ...`. This is *not* a sign
  the service is unhealthy.
- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors. The startup probe is **TCP** on port
  8080 (not HTTP), so a "healthy" revision can still error on requests if
  Postgres or GCS isn't reachable — check application logs, not just
  revision status.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`error opening storage backend: ... Access Denied`:** on a *fresh first
  deploy*, this can be a one-time IAM propagation race (the storage service
  account's `roles/storage.objectAdmin` grant can take 1–2 minutes to
  propagate) — wait a minute and let Cloud Run retry, or force a new
  revision. If it persists beyond a few minutes, verify the grant:
  ```bash
  BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  gcloud storage buckets get-iam-policy "gs://$BUCKET"
  ```
- **`admin-create` job fails with "instance application not yet created":**
  the main server hasn't finished its first boot yet. Confirm the service is
  actually `Ready` (`gcloud run services describe`) before re-running the
  job; the job's own script retries internally, but if it exhausts all 20
  attempts, wait for the service to stabilise and re-run the `gcloud run
  jobs execute ... --wait` command from Task 2.
- **`admin-create` retry fails with `sql: no rows in result set` /
  `IsUsernameAvailable` reports the username is already taken, but you never
  successfully created it:** this means an earlier attempt left an orphaned
  `accounts` row with no matching `users` row (GoToSocial inserts the account
  first, then panics on the user-row step if the instance application wasn't
  ready). Recover by connecting directly to the database and cleaning up the
  orphaned row before retrying:
  ```bash
  INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  gcloud sql connect "$INSTANCE" --user=gotosocial --project="$PROJECT"
  ```
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='admin';  -- or your superuser_username
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  Then re-run the `admin-create` job from Task 2.
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE` and the `db-init` job completed with the database showing `C`
  collation:
  ```sql
  SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'gotosocial';
  ```
  If `GTS_DB_TLS_MODE` was manually overridden away from `"enable"` on Cloud
  Run, restore it — `"disable"` fails ("no encryption" against the raw
  private IP), and `"require"` fails certificate verification against Cloud
  SQL's cert.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including the `GTS_DB_TLS_MODE`
requirement, `max_instance_count` being a hard architectural ceiling, and the
`host` immutability).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, the GCS
`storage` bucket, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15, `C` collation), secrets, `storage` bucket, and runs `db-init` |
| 2 — Access & verify | Manual | Confirm health with a `User-Agent` header; manually trigger `admin-create`; retrieve `SUPERUSER_PASSWORD` |
| 3 — Operate | Manual | Inspect revisions, scale (never above `max_instance_count = 1`), update version, manage secrets/backups, DB and storage access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose the 418/User-Agent quirk, storage IAM propagation, admin-create failures, orphaned account rows, DB/TLS issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
