---
title: "Cal.com on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Cal.com on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Cal.com on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Cal.com is an open-source scheduling platform — the self-hosted Calendly alternative — built with Next.js and Prisma on PostgreSQL. This lab takes you through the full operational lifecycle of the **Cal.com on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Cal.com product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and complete Cal.com's onboarding.
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

1. Click **Deploy** in the RAD platform top navigation, open **Cal.com (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (Next.js on port 3000), a Cloud SQL
   (PostgreSQL 15) database with its Secret Manager secrets (DB password plus
   auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`), mirrors the
   Cal.com image into Artifact Registry, and runs a one-shot database-initialisation
   job that creates the empty database and role. **No GCS bucket is created** —
   Cal.com keeps all state in PostgreSQL. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~calcom" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Cal.com's health path is `/`, which returns
   HTTP 200 once the app has finished running its Prisma migrations on first boot —
   the schema is created **on boot**, not by the init job, so allow several minutes
   on a fresh deploy (the startup probe window is ~8 minutes for exactly this
   reason):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser and complete Cal.com's onboarding to create the
   initial administrator/owner account, then connect at least one calendar.
   **Immediate hardening note:** self-hosted Cal.com allows self-service sign-up by
   default — restrict it (or front the service with IAP) if the instance should not
   be public. The database password can be retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~calcom" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Note the URL discipline: `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` default to the
   deterministic `run.app` URL. Before sharing booking links on a custom domain, set
   `webapp_url` — the public URL is baked into every booking and OAuth link.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). The
   default is scale-to-zero (`min = 0`, `max = 1`, request-based billing); set
   `min_instance_count = 1` if cold starts bother your bookers.

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; the new image tag is mirrored and a new revision
   rolls out, applying any pending Prisma migrations on its first boot.

4. **Manage secrets and jobs** — and know which secrets are immutable:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~calcom"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   `CALENDSO_ENCRYPTION_KEY` encrypts stored calendar/OAuth credentials and
   `NEXTAUTH_SECRET` signs sessions — **never rotate either after first boot**
   outside a planned maintenance window (rotation orphans every connected calendar
   or logs out every user, respectively).

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=calcom --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour, including
   scale-to-zero periods), and CPU / memory utilisation. The module also provisions an
   **uptime check** against `/`; confirm it is green under Monitoring → Uptime checks,
   and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Cal.com releases.

- **Revision unhealthy / service won't serve:** Cal.com runs `prisma migrate deploy`
  on every start, and the startup probe allows roughly 8 minutes for first-boot
  migrations. Inspect the latest revision and its logs before concluding the service
  has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **OOM crash at startup:** `memory_limit` must be **≥ 2 GiB** — Next.js 16
  OOM-crashes below it and the revision never becomes Ready.
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and `enable_cloudsql_volume = true` —
  direct private-IP TCP fails Prisma's certificate verification against Cloud SQL's
  CA; the Auth Proxy socket is required.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Server refuses to boot / URL errors:** Cal.com validates its public URL at
  startup. Verify `webapp_url` (or the injected default) is a real URL — the image's
  `localhost:3000` default is rejected.
- **403 / permission errors:** verify the runtime service account's IAM roles; if
  IAP is enabled, remember it blocks *all* unauthenticated requests — including
  public booking pages and embeds.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database (all users, event types, and bookings), Secret Manager secrets
(including `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`), and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, mirrors the image, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; complete onboarding, restrict open sign-up, set `webapp_url` |
| 3 — Operate | Manual | Inspect revisions, scale, update version, respect immutable secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, OOM, database, init-job, URL-validation, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
