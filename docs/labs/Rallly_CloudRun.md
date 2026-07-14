---
title: "Rallly on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Rallly on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Rallly on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Rallly is an open-source, self-hosted meeting-scheduling and group-poll application —
a privacy-friendly alternative to Doodle — built with Next.js and Prisma. This lab
takes you through the full operational lifecycle of the **Rallly on Cloud Run** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Rallly product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and SMTP settings.
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

1. In the RAD platform, open **Rallly (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_CloudRun)
   documents every input by group, with defaults. If you already have an SMTP relay,
   set `smtp_user` and `smtp_password` now (the default `smtp_host` is
   `smtp.gmail.com`) so email login works from the first boot. Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_PASSWORD`, `NEXTAUTH_SECRET`,
   an optional `SMTP_PWD`, and the database password), builds the container image,
   and runs a one-shot database-initialisation job that creates the empty database
   and role. First deploys take roughly **15–25 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~rallly" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is fully ready — database migrated and reachable. Rallly's
   own status endpoint only returns 2xx once the app has finished the first-boot
   Prisma migration and confirmed its dependencies (this is a stricter check than
   the platform's own TCP startup probe, which only confirms the port is bound):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/status"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Rallly's login is **passwordless and
   email-based** — there is no pre-seeded admin account. Enter your email on the
   sign-in page; Rallly emails a verification link/code through the configured SMTP
   relay. If nothing arrives, confirm SMTP is actually configured (Task 3, step 4)
   before assuming the deployment is broken.

3. If you plan to front the service with a custom domain, set `base_url` to that
   domain and apply via **Update** so invite and login links resolve to the address
   users actually visit, rather than the raw `run.app` URL.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). Rallly keeps all state in PostgreSQL, so it scales
   horizontally without any shared cache or filesystem.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Rallly's own `./docker-start.sh` runs `prisma migrate deploy` on every
   boot, so schema migrations apply automatically — no separate migration step is
   required.

4. **Manage secrets and SMTP:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~rallly"
   gcloud run services describe "$SERVICE" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'   # confirm SMTP_* / base URL env
   ```

   Never rotate `SECRET_PASSWORD` or `NEXTAUTH_SECRET` outside of a planned
   maintenance window — see Task 5.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=rallly --project="$PROJECT"
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
   CPU / memory utilisation. The module can provision an **uptime check**; confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Rallly releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe is **TCP by design** (not `/api/status`, which only returns 2xx at full
  application readiness) and allows roughly 230 seconds of budget (30s initial delay
  + 10 retries at 20s) to cover the first-boot Prisma migration.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Users cannot sign in:** Rallly's login is passwordless and email-based. Confirm
  `smtp_user` / `smtp_password` are set (default `smtp_host = smtp.gmail.com` is not
  enough on its own) and check the running revision's env vars for `SMTP_*`.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Invite/login links point at the wrong host:** set `base_url` to your custom
  domain — otherwise `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` default to the raw
  `run.app` URL.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `SECRET_PASSWORD` or
`NEXTAUTH_SECRET` after first boot, and the `db_name`/`db_user` immutability rule).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Status endpoint returns 200; sign in via emailed verification link |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/SMTP, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, SMTP, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
