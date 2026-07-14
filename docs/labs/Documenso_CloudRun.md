---
title: "Documenso on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Documenso on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Documenso on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Documenso is an open-source DocuSign alternative — a Next.js + Prisma
application for sending, signing, and managing e-signature documents. This lab
takes you through the full operational lifecycle of the **Documenso on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Documenso product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete Documenso's first-run
  account setup.
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

1. In the RAD platform, open **Documenso (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`NEXTAUTH_SECRET`,
   `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, an
   HMAC key pair for optional S3 upload transport, and the database password),
   a Cloud Storage `uploads` bucket, a Cloud Filestore (NFS) instance, builds
   the custom container image, and runs a one-shot database-initialisation
   job. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~documenso" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. Documenso has no dedicated health endpoint, so
   the startup probe only checks that the container is listening on its port —
   verify readiness by hitting the app directly instead:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL"   # expect 200 (or a redirect to /signin)
   ```

2. Open `$SERVICE_URL` in a browser. Documenso provisions **no bootstrap admin
   account** — the first person to complete sign-up through the app's own web
   UI becomes the account owner. Create that account now.

3. Set `webapp_url` to the Cloud Run URL (or a custom domain once one is
   registered) via **Update**. Until it is set explicitly, the entrypoint
   re-derives `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` from the platform-injected
   `CLOUDRUN_SERVICE_URL` on every boot, which is fine for a quick test but not
   stable across redeploys or custom domains.

4. **Signing certificate.** With no certificate supplied, the app self-signs a
   throwaway `.p12` at boot so document signing works end-to-end for testing —
   but the signature is not trusted by PDF readers. For anything beyond this
   lab, supply a real certificate (see Task 3, step 5).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply).
   Documenso defaults to `min_instance_count = 0` (scale-to-zero, adding
   cold-start latency to the first request after idle) and
   `max_instance_count = 1`.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds (from
   `docker.io/documenso/documenso:${DOCUMENSO_VERSION}`) and a new revision
   rolls out. Prisma migrations run automatically on container start — there
   is no separate migrate job to run.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~documenso"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Wire a production signing certificate** (recommended before real use): set
   `secret_environment_variables` to map `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
   (a base64-encoded `.p12`) and `NEXT_PRIVATE_SIGNING_PASSPHRASE` to secrets in
   Secret Manager, then apply via **Update**. Never regenerate
   `NEXT_PRIVATE_ENCRYPTION_KEY` in place afterward — it decrypts data already
   stored in Postgres; rotate only through the secondary-key slot.

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~documenso" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=documenso --project="$PROJECT"
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
   CPU / memory utilisation. Documenso's `uptime_check_config` is disabled by
   default; enable it via **Update** if you want a Monitoring → Uptime check and
   its associated alert policy.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Documenso releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe is **TCP** on port 3000 (not HTTP), so
  a "healthy" revision can still 500 on requests if Postgres isn't reachable —
  check application logs, not just revision status.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed. If
  `enable_cloudsql_volume` is left at this module's own default (`false`), the
  entrypoint does not get a Unix-socket `DB_HOST` and falls back to a direct-IP
  connection instead — set `enable_cloudsql_volume = true` if the app can't
  reach the database.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including `enable_cloudsql_volume`
defaulting `false` on this module, the immutability of `db_name`/`db_user`
after first deploy, and never rotating `NEXT_PRIVATE_ENCRYPTION_KEY` in place).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, Filestore instance, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, uploads bucket, Filestore, and runs DB init |
| 2 — Access & verify | Manual | Service responds; create the initial owner account in the UI; note the self-signed cert caveat |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, wire a production signing cert, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, `enable_cloudsql_volume`, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
