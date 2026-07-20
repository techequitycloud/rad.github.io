---
title: "Planka on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Planka on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Planka on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Planka is an open-source, self-hosted, Trello-like kanban board application
for team and personal project management. This lab takes you through the full
operational lifecycle of the **Planka on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Planka product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and log in with the generated admin credential.
- Perform day-2 operations — inspect, scale, update, and manage backups.
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

1. In the RAD platform, open **Planka (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds the custom Planka image (thin wrapper `FROM
   ghcr.io/plankanban/planka`), provisions the Cloud Run service, a Cloud SQL
   (PostgreSQL 15) database with its Secret Manager password secret, the
   `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` secrets, a `storage` GCS bucket,
   and runs a one-shot database-initialisation job. First deploys take
   roughly **15–25 minutes** (the Cloud Build image build and Cloud SQL
   creation dominate).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~planka" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving:

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Retrieve the generated admin password — unlike a fixed, publicly-known
   default credential, Planka's `DEFAULT_ADMIN_PASSWORD` is a real,
   per-deployment generated secret:

   ```bash
   PASSWORD_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~planka AND name~default-admin-password" \
     --format="value(name)" | head -1)
   gcloud secrets versions access latest --secret="$PASSWORD_SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in with `admin@example.com` and
   the password retrieved above. **Planka does not force a password reset on
   first login** — change the password immediately via Planka's own account
   settings, since the credential is a real secret worth rotating out of the
   initial deployment value. Then create a board, list, and card to confirm
   the database write path.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — Planka has no cross-instance coordination
   concern (no cache, no queue; real-time updates ride Socket.io per-instance),
   so raising `max_instance_count` is safe.

3. **Update the application version tag** via the RAD platform's **Update**
   flow — this re-triggers the custom image build with the new
   `PLANKA_VERSION` build ARG.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~planka"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=planka --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Look for the `[cloud-entrypoint]` line — it reports which `DATABASE_URL`
   connection mode the entrypoint resolved (socket-unsupported/private-IP,
   loopback, or direct private-IP) and the derived `BASE_URL`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, latency, instance count, and CPU/memory utilisation. The
   module can provision an **uptime check** (disabled by default); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
  If the revision never becomes Ready, check the startup probe's configured
  path — Planka's own healthcheck target is the root path `/`, but this
  module's `startup_probe`/`liveness_probe` variables currently default to
  `/api/status`. If probes are failing, override the path to `/` and
  redeploy.
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the initialisation job
  completed. Check the container logs for the `[cloud-entrypoint]` line
  reporting which `DATABASE_URL` mode was resolved.
- **Initialisation job failed:**
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" --project="$PROJECT" --region="$REGION"
  ```
- **Can't log in with the admin credential:** `DEFAULT_ADMIN_PASSWORD` only
  seeds the account on the *first* (empty-database) boot — if the database
  was already initialised, or the password was already changed, the original
  seeded value no longer works; use Planka's own password-recovery flow (or
  reconnect to the database directly) instead.
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
the Cloud Run service, Cloud SQL database, Secret Manager secrets, the GCS
bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, a GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; log in with the generated admin credential and create a board |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
