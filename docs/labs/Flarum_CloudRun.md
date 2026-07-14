---
title: "Flarum on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Flarum on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Flarum on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Flarum is a free, open-source forum and discussion platform — a modern,
extensible alternative to traditional bulletin-board software, built on PHP
with a JavaScript/Mithril front end. This lab takes you through the full
operational lifecycle of the **Flarum on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Flarum forum features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and retrieve the generated admin credential.
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

1. In the RAD platform, open **Flarum (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager secrets (the auto-generated
   `FLARUM_ADMIN_PASS`; the database password is managed separately), a
   Cloud Filestore (NFS) share for uploaded avatars/attachments, a
   `flarum-assets` Cloud Storage bucket plus a default `data` bucket, builds
   the container image (a thin wrapper `FROM mondedie/flarum`), and runs a
   one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~flarum" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Flarum serves its public forum home page
   at `/` once installed and the database is reachable:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Retrieve the generated administrator password — the admin username and
   email are fixed by the module at `admin` / `admin@techequity.cloud` and
   are not exposed as configuration inputs:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~flarum AND name~admin-pass" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and sign in with `admin` / the password
   retrieved above. `FORUM_URL` is auto-wired to the predicted `run.app`
   service URL on Cloud Run, so absolute links and asset URLs should already
   be correct. If you later front the service with a custom domain or
   external HTTPS load balancer, update `FORUM_URL` via
   `environment_variables` to match the actual public hostname, or Flarum
   will generate links against the stale default.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Keep `max_instance_count` at `1` unless you
   have verified Flarum's behaviour under multiple concurrent instances
   sharing the same NFS assets volume and database.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying it via **Update**; the value is
   passed through the app-specific `FLARUM_VERSION` build ARG (not the
   generic version arg), a new image builds, and a new revision rolls out.
   `latest` maps to the `mondedie/flarum` image's own `stable` tag.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~flarum"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=flarum --database=flarum --project="$PROJECT"
   ```

6. **Check uploaded assets persistence** — avatars and attachments live on
   Cloud Filestore (NFS) at `/flarum/app/public/assets`, mounted because
   `enable_nfs = true` by default, so they survive restarts and scale-to-zero:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   ```

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
   CPU / memory utilisation. The module's **uptime check is disabled by
   default** (`uptime_check_config.enabled = false`); enable it via
   configuration if you want Cloud Monitoring to alert on outages, then
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Flarum releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe is a **TCP** check on port 8888
  with a generous ~5-minute window (`failure_threshold=20`, `period_seconds=15`)
  to accommodate the first-boot installer, and the liveness probe is HTTP
  `GET /` with a 300-second initial delay.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** by default (`enable_cloudsql_volume = false`)
  Flarum connects to Cloud SQL over **direct private-IP TCP** through VPC
  egress, not the Auth Proxy socket. Confirm the Cloud SQL instance is
  `RUNNABLE`, VPC egress isn't blocking the private range, and the `db-init`
  job completed successfully.
- **db-init job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log —
  remember `container_image_source` must stay `custom`; switching to `prebuilt`
  bypasses the `FLARUM_VERSION` build-arg mechanism this module relies on.
- **Locked out of the admin account:** the `FLARUM_ADMIN_PASS` secret is only
  read on first boot — rotating it afterwards does not change the live admin
  password; reset it from the Flarum admin UI or the database instead.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the immutability of `db_name`/`db_user`
after first deploy, and why `php_memory_limit`/`upload_max_filesize`/
`post_max_size` are inert on this module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, the Filestore (NFS) share, GCS
buckets (`flarum-assets` and `data`), and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), Filestore (NFS), storage buckets, secrets, and runs db-init |
| 2 — Access & verify | Manual | Health check passes; retrieve `FLARUM_ADMIN_PASS` and sign in as `admin` |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access, verify NFS persistence |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, db-init, build, admin-lockout, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
