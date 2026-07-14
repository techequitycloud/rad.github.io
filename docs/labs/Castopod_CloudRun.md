---
title: "Castopod on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Castopod on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Castopod on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Castopod is an open-source, ActivityPub-native podcast hosting platform built on CodeIgniter 4 (PHP 8) and served by FrankenPHP/Caddy. This lab takes you through the full operational lifecycle of the **Castopod on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Castopod product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and complete Castopod's install wizard.
- Perform day-2 operations — inspect, scale, update, and manage secrets, media, and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore NFS, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Castopod (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (FrankenPHP/Caddy on port 8080), a
   Cloud SQL (MySQL 8.0) database with its Secret Manager secrets (DB password plus
   the auto-generated `CP_ANALYTICS_SALT`), a `media` GCS bucket, an NFS share for
   durable episode audio and artwork, builds the custom container image (a thin
   build on the upstream `castopod/castopod` image that grafts the platform
   entrypoint), and runs a one-shot database-initialisation job. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~castopod" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Castopod's unauthenticated homepage `/` returns
   HTTP 200 once the app has booted and connected to MySQL — CodeIgniter runs its
   schema migrations on first start, so allow a few minutes on a fresh deploy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser and complete Castopod's **web install wizard** —
   create the first super-admin account and set the instance name and podcast
   defaults. The base URL is derived automatically from the runtime service URL, so
   feed and media links point at the right host. The database password (in Secret
   Manager) can be retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~castopod" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Upload a short test episode (audio + artwork) and confirm the public RSS feed
   renders. Public feeds and media downloads are why `ingress_settings = "all"` is
   the default — don't restrict it (or add IAP) on a public podcast instance.

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
   default is scale-to-zero (`min = 0`) with `max = 1`; keep `max_instance_count = 1`
   unless the shared media filesystem and cache are confirmed multi-instance-safe.

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds and a new revision rolls out,
   applying any pending CodeIgniter migrations on its first start.

4. **Manage secrets, media storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~media"
   gcloud filestore instances list --project="$PROJECT"           # NFS for media
   ```

   Keep `CP_ANALYTICS_SALT` stable — it anonymises listener analytics, and changing
   it breaks de-duplication continuity for previously recorded listeners.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=castopod --project="$PROJECT"
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
   scale-to-zero periods), and CPU / memory utilisation. Feed fetches from podcast
   apps show up as steady background request traffic. Review Monitoring → Uptime
   checks and Alerting → Policies for the provisioned checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Castopod releases.

- **Revision unhealthy / service won't serve:** the startup probe is TCP with a
  retry window that covers first-boot CodeIgniter migrations; the liveness probe
  hits `/`. Inspect the latest revision and its logs before concluding the service
  failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (MySQL 8.0) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. Note
  Castopod connects over the **private-IP TCP** address (CodeIgniter's `mysqli`
  driver cannot use the Auth Proxy socket directory) — the entrypoint resolves this
  automatically.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Uploads vanish after a restart:** verify `enable_nfs = true` and the Filestore
  instance is healthy — with NFS off, episode audio and artwork live on ephemeral
  disk and are lost on every restart or redeploy.
- **Image build failed:** review Cloud Build history for the failed build's log.
  The image is a custom build on `castopod/castopod` that grafts the entrypoint
  which writes the DB config into Castopod's `.env` — the upstream image alone
  cannot consume the injected credentials.
- **Broken feed or media links:** the entrypoint derives the base URL from the
  runtime service URL; if you moved to a custom domain, redeploy so feeds pick up
  the new host.
- **403 / permission errors:** verify the runtime service account's IAM roles; if
  IAP was enabled, remember it blocks *all* unauthenticated access — including
  public RSS feeds and media downloads.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database (podcasts, episodes, users, analytics), Secret Manager secrets
(including `CP_ANALYTICS_SALT`), the `media` GCS bucket, the NFS share holding
uploaded audio and artwork, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), NFS, media bucket, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | Homepage returns 200; complete the install wizard; upload a test episode and check the feed |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/media/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime checks |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, NFS-media, build, base-URL, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
