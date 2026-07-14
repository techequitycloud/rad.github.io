---
title: "WriteFreely on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy WriteFreely on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# WriteFreely on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

WriteFreely is an open-source, minimalist, federated blogging platform written in
Go — a lightweight Medium alternative for publishing clean, distraction-free
writing. This lab takes you through the full operational lifecycle of the
**WriteFreely on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on WriteFreely product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running blog.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
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

1. In the RAD platform, open **WriteFreely (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager secrets (three AES-256 keys —
   `cookies-auth`, `cookies-enc`, `email-key` — plus the database password), a
   dedicated `writefreely-uploads` Cloud Storage bucket, builds the custom
   config-gen container image, and runs a one-shot database-initialisation job.
   First deploys take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~writefreely" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. WriteFreely has no dedicated `/health` endpoint —
   the liveness probe is an HTTP `GET /` that expects a `200` from the home page:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser to confirm the blog's home page renders.
   Registration is **closed by default** (`open_registration = false`) and no
   admin account is seeded, so create the first account now:

   - Temporarily set `WF_OPEN_REGISTRATION = "true"` in `environment_variables`
     and apply via **Update**, register through the UI, then set it back to
     `"false"` and apply again; **or**
   - Run WriteFreely's built-in admin creation command against the running
     container (see Task 3, step 5, for how to reach a shell/`exec` equivalent
     via a one-off job, since Cloud Run has no persistent `exec` into a running
     revision).

3. **Do not rotate the AES-256 keys** (`cookies-auth`, `cookies-enc`,
   `email-key`) after this first boot — doing so logs out every user and makes
   previously encrypted email addresses undecryptable.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). WriteFreely defaults to `min_instance_count = 0`
   (scale-to-zero) and `max_instance_count = 1`; set `min_instance_count = 1` if
   the occasional cold-start delay after idle is undesirable.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new
   revision rolls out. Pin a specific release rather than leaving
   `application_version = "latest"` in production, so rebuilds stay reproducible.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" \
     --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=writefreely --database=writefreely --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. On first boot look for the
   entrypoint's progress lines (`WriteFreely: rendered config.ini …`, `… seeded
   stable encryption keys …`, `… starting server …`):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module also provisions an
   **uptime check** (when the endpoint is publicly reachable); confirm it is
   green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with WriteFreely releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe is TCP (Ready as soon as port 8080 is bound); the liveness probe
  is HTTP `GET /`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the initialisation job completed
  successfully. WriteFreely on Cloud Run connects over **private-IP TCP**
  (`enable_cloudsql_volume = false`), not a socket — do not confuse this with
  the GKE variant's Auth Proxy sidecar.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log
  — `container_image_source` must stay `custom` since the config-gen entrypoint
  is not present in any prebuilt upstream image.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate the
AES-256 keys after first boot, and why `db_name`/`db_user` are immutable after
first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created — the
Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), 3 AES-256 key secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Home page returns 200; create the initial account via temporary open registration |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
