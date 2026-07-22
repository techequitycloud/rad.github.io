---
title: "Tandoor on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Tandoor on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Tandoor on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Tandoor Recipes is an open-source, self-hosted recipe manager and meal
planner with URL-import recipe scraping. This lab takes you through the full
operational lifecycle of the **Tandoor on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Tandoor product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including retrieving the generated superuser credential.
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

1. In the RAD platform, open **Tandoor (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Tandoor_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY`,
   `DJANGO_SUPERUSER_PASSWORD`, and the database password), a Cloud Storage
   `data` bucket, and runs two one-shot jobs: `db-init` (creates the database
   and user) and `create-superuser` (bootstraps the initial admin account).
   First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tandoor" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Tandoor has no dedicated unauthenticated
   health endpoint, so the platform probes (and this check) target Django's
   public login page:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/accounts/login/"   # expect 200
   ```

2. Retrieve the generated superuser credential — Tandoor has **no
   self-registration flow and no fixed default credential**, unlike some
   apps in this catalogue:

   ```bash
   SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~tandoor-superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL/accounts/login/` in a browser and log in with username
   `admin` (or your configured `admin_username`) and the password retrieved
   above. Consider changing the password immediately after first login as a
   good security practice.

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
   edit would be reverted on the next apply). Tandoor has no background
   worker, so scaling beyond one instance needs no special coordination.

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new revision rolls
   out. Tandoor publishes a genuine `latest` tag upstream, so this reflects
   real upstream releases (unlike some apps in this catalogue whose
   version tag is cosmetic only).

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tandoor"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=tandoor --project="$PROJECT"
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
   behaviour), and CPU / memory utilisation. The module can provision an
   **uptime check** (when `uptime_check_config.enabled = true` — it
   defaults to `false`); if enabled, confirm it is green under Monitoring →
   Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Tandoor releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets
  resolved. The startup probe targets `/accounts/login/` and requires
  Postgres connectivity plus applied migrations to return 200.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed
  successfully.
- **Can't log in / no credential known:** retrieve
  `DJANGO_SUPERUSER_PASSWORD` from Secret Manager (Task 2, step 2) — there is
  no fixed fallback credential to fall back on.
- **`create-superuser` job failed:** list executions and read the failed
  one's logs — a common cause is the job running before `db-init` finished
  (it should be listed as a dependency; the job retries up to twice):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-create-superuser" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's
  log (Tandoor is prebuilt, so this only applies if `container_image_source`
  was overridden to `custom`).
- **403 / permission errors:** verify the runtime service account's IAM
  roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`SECRET_KEY` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). Delete removes everything the module
created — the Cloud Run service, Cloud SQL database, Secret Manager secrets,
GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs `db-init` + `create-superuser` |
| 2 — Access & verify | Manual | Health check passes; retrieve the generated superuser credential and log in |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
