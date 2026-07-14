---
title: "Gitea on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Gitea on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gitea on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Gitea is a lightweight, self-hosted Git service and software forge — repository hosting, issues, pull requests, code review, and a package registry from a single Go binary. This lab takes you through the full operational lifecycle of the **Gitea on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Gitea product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the forge, claim the first-registrant admin account, and verify health.
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

1. Click **Deploy** in the RAD platform top navigation, open **Gitea (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gitea_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (DB password, Gitea `SECRET_KEY` and
   `INTERNAL_TOKEN`), an NFS share holding repositories/LFS/attachments, a GCS
   `data` bucket, builds the thin custom image over `gitea/gitea` via Cloud Build,
   and runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gitea" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Gitea's health path is `/api/healthz`, which
   returns HTTP 200 without authentication once the server is up (first boot also
   runs schema migrations — allow up to ~60 seconds on a fresh deploy):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
   ```

2. Open `$SERVICE_URL` in a browser. The first-run web installer is skipped
   (`INSTALL_LOCK=true` — configuration is env-driven), and **the first user to
   register becomes the administrator**. Click **Register**, create your admin
   account immediately, and sign in.

3. **Immediate hardening:** self-registration is enabled by default. For a private
   forge, disable it right after claiming the admin account by adding
   `GITEA__service__DISABLE_REGISTRATION = "true"` to `environment_variables` via
   the RAD **Update** flow. Also set `public_domain` / `public_url` to the service's
   real host so clone URLs are correct (the `localhost` default breaks them).

4. Create a test repository in the UI and clone it over **HTTPS** (Cloud Run routes
   only the HTTP port, so SSH clone URLs are not reachable on this platform):

   ```bash
   git clone "$SERVICE_URL/<your-user>/<test-repo>.git"
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
   manual `gcloud` edit (a manual edit would be reverted on the next apply).
   Defaults are min `0` / max `1`; set min `1` for teams that notice cold starts,
   and `cpu_always_allocated = true` only if you rely on scheduled mirror sync or
   timed webhook delivery.

3. **Update the application version** by changing the `application_version` input
   via **Update** on the deployment details page; Cloud Build rebuilds the image
   from the matching `gitea/gitea` tag and a new revision rolls out (Gitea migrates
   its schema automatically on startup).

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gitea"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~gitea"
   ```

5. **Open a database session** for inspection or maintenance. The application
   role and database are tenant-prefixed — read the real names from the service
   env rather than assuming `gitea`:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="json" | grep -A1 '"name": "DB_USER"' | grep value | cut -d'"' -f4)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   On every start the platform entrypoint logs a `Gitea DB wired: host=… sslmode=…`
   line — useful confirmation of the database wiring.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module's **uptime check** is disabled by default —
   enable `uptime_check_config` for production and confirm it is green under
   Monitoring → Uptime checks; review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gitea releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs; the startup probe targets `/api/healthz` with a 30-second initial delay:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. Check
  the `Gitea DB wired:` log line — the user/name must be the tenant-prefixed values,
  never a hardcoded `gitea`.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **`lookup $(DB_HOST): no such host` in logs:** the stock upstream image was
  deployed instead of the custom build. `container_image_source` must be `custom` —
  Cloud Run does not interpolate `$(VAR)` env references, so the platform entrypoint
  in the custom image is required to compose the DB connection.
- **Broken clone URLs / redirects to `localhost`:** `public_domain` / `public_url`
  still hold their defaults — set them to the service host via **Update**.
- **SSH clone fails:** expected — Cloud Run exposes only the HTTP port. Use HTTPS
  remotes with a Gitea access token.
- **NFS mount / repositories missing:** verify `enable_nfs = true` and that the
  execution environment is `gen2` (required for NFS mounts in Cloud Run).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets (DB password, `SECRET_KEY`,
`INTERNAL_TOKEN`), GCS buckets, the NFS-held repository data, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), NFS, GCS, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; first registrant claims the admin account; registration hardened |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, image-source, clone-URL, NFS, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
