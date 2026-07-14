---
title: "Outline on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Outline on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Outline on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Outline is a fast, collaborative, Notion-style team knowledge base and wiki with real-time editing and powerful search. This lab takes you through the full operational lifecycle of the **Outline on Cloud Run** module on Google Cloud: deploy it, wire up the required authentication provider, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Outline product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Verify the running service and configure the **required** OIDC authentication provider.
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

1. Click **Deploy** in the RAD platform top navigation, open **Outline (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (DB password plus Outline's `SECRET_KEY` and
   `UTILS_SECRET`), a Filestore NFS share for uploaded files, a dedicated `storage`
   GCS bucket, builds the custom container image via Cloud Build, and runs a one-shot
   database-initialisation job. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~outline" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Outline's health path is `/`, which responds once
   the entrypoint has connected to PostgreSQL, run the Sequelize migrations, and
   connected to Redis (allow 60+ seconds on a fresh deploy / cold start):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser. **Expect an empty login page** — this is the
   module's most important first-run fact, not a failure: the `OIDC_*` variables ship
   intentionally blank, and without a configured identity provider Outline registers
   **zero** auth providers. The service is healthy; sign-in requires the next step.

3. **Configure the required OIDC provider.** Create an OAuth client at your IdP
   (e.g. Google: APIs & Services → Credentials) with
   `$SERVICE_URL/auth/oidc.callback` as an authorized redirect URI — the callback
   must be on the **same host** as the injected `URL`. Then wire the endpoints:

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-env-vars="OIDC_AUTH_URI=https://accounts.google.com/o/oauth2/v2/auth,OIDC_TOKEN_URI=https://oauth2.googleapis.com/token,OIDC_USERINFO_URI=https://openidconnect.googleapis.com/v1/userinfo,OIDC_USERNAME_CLAIM=email"
   ```

   Bind the client credentials as secrets. **Gotcha:** `OIDC_CLIENT_ID` and
   `OIDC_CLIENT_SECRET` exist as *plain empty env vars*, so gcloud refuses a direct
   secret conversion ("already set with a different type") — remove first, then bind:

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --remove-env-vars=OIDC_CLIENT_ID,OIDC_CLIENT_SECRET
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-secrets="OIDC_CLIENT_ID=<client-id-secret>:latest,OIDC_CLIENT_SECRET=<client-secret-secret>:latest"
   ```

   Reload the login page — your provider button appears; the first user to sign in
   creates the workspace. The DB password secret can be retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~outline" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

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
   default is scale-to-zero (`min = 0`, `max = 1`); set `min = 1` if cold starts
   bother your editors.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; Cloud Build rebuilds the custom image and a new revision rolls out — the entrypoint runs any pending Sequelize migrations on start.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~outline"   # DB password, SECRET_KEY, UTILS_SECRET
   gcloud run jobs list --project="$PROJECT" --region="$REGION"       # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~outline"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=outline --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   On startup, look for `Assembled DATABASE_URL`, `Database is ready.`, and the
   Sequelize migration output.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. An **uptime check** can be enabled via
   `uptime_check_config` (off by default); when on, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Outline releases.

- **Revision unhealthy / service won't serve:** the startup probe allows 60 seconds
  plus six retries for the entrypoint to wait for PostgreSQL and run migrations.
  Inspect the latest revision and its logs before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Empty login page (the app-specific one):** this is *not* a deployment failure —
  the `OIDC_*` placeholders are blank until you configure an IdP (Task 2). If a
  provider is configured but login loops or errors, verify the redirect URI is
  `<URL>/auth/oidc.callback` on the exact host in the injected `URL`:
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format="json(spec.template.spec.containers[0].env)" | grep -A1 '"URL"'
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed
  successfully. The connection uses the Auth Proxy socket — `enable_cloudsql_volume`
  must stay `true`.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Redis errors / reconnect loop in logs:** Outline requires Redis. Verify
  `enable_redis = true` and that the shared NFS host (which co-hosts Redis) is
  running, or that `redis_host` points at a reachable endpoint.
- **NFS mount / uploads not persisting:** verify `enable_nfs = true`, the execution
  environment is `gen2`, and `nfs_mount_path` is `/var/lib/outline/data`.
- **Image build failed:** review Cloud Build history for the failed build's log.
  This is a custom-build module — the upstream image lacks the entrypoint that
  assembles `DATABASE_URL`/`REDIS_URL`/`URL` and runs migrations.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets (DB password, `SECRET_KEY`, `UTILS_SECRET`),
GCS buckets (including the `storage` bucket), Filestore NFS share, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), NFS, GCS bucket, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; configure the required OIDC provider and complete first sign-in |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, OIDC, database, init-job, Redis, NFS, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
