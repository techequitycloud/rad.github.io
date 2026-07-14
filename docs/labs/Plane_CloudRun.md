---
title: "Plane on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Plane on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Plane on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Plane is an open-source project-management platform — a Jira / Linear alternative for issues, cycles, modules, and roadmaps. This lab takes you through the full operational lifecycle of the **Plane on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Plane product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the RabbitMQ sidecar and first-boot migrations.
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

1. Click **Deploy** in the RAD platform top navigation, open **Plane (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service running Plane's **all-in-one
   container** (api + Celery worker/beat + web/space/admin frontends + live +
   migrator behind an internal Caddy proxy on port 80) with a **RabbitMQ sidecar**
   container, a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (including the auto-generated `SECRET_KEY` and `LIVE_SERVER_SECRET_KEY`), Redis on
   the shared NFS host, a dedicated `storage` GCS bucket, builds the custom container
   image via Cloud Build, and runs a one-shot `db-init` job. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~plane" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Plane's health path is `/health`, served by the
   internal Caddy proxy once the first-boot migrator has finished (allow several
   minutes on a fresh deploy — the startup probe permits up to ~5 minutes):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
   ```

2. Verify the entrypoint composed the three connection URLs Plane requires:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -E "Composed (DATABASE|REDIS|AMQP)_URL"
   ```

3. Open `${SERVICE_URL}/god-mode/` in a browser — Plane's instance-admin panel —
   and create the instance admin account. Then open `${SERVICE_URL}/` to sign up
   and create your first workspace, project, and issue.

4. **Immediate hardening notes:** file uploads (attachments, avatars) require an
   S3-compatible endpoint — supply GCS HMAC keys or external S3 credentials via the
   `environment_variables` input before relying on uploads (see the Configuration
   Guide). The application secrets can be retrieved if needed:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; note the two containers — the Plane all-in-one and the `mq` RabbitMQ
   sidecar):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). The
   default is scale-to-zero (`min = 0`, `cpu_always_allocated = false`); if your team
   relies on timely Celery notifications/webhooks/exports, set
   `cpu_always_allocated = true` and `min_instance_count = 1`.

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds (the wrapper Dockerfile pins
   `makeplane/plane-aio-community:<version>` — note there is no `latest` tag
   upstream, so use `stable` or a real release tag) and a new revision rolls out.
   The migrator applies schema changes automatically on startup.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~plane"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=plane_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — supervisord multiplexes every bundled sub-service (migrator, api,
   worker, beat, frontends, Caddy) plus the `mq` sidecar into the revision logs:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check** against
   `/health`; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Plane releases.

- **Revision unhealthy / service won't serve:** the first boot runs Django
  migrations (the AIO `migrator` step) before Caddy answers on `/health`; the
  startup probe allows up to ~5 minutes. Inspect the latest revision and its logs
  before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, the `db-init` job completed, and the
  entrypoint logged `Composed DATABASE_URL ... sslmode=require`.
- **Celery / broker errors (worker cannot connect):** Plane requires RabbitMQ; on
  Cloud Run it is the in-pod `mq` sidecar at `127.0.0.1:5672`. Check the logs for
  `Composed AMQP_URL host=127.0.0.1:5672` and for the sidecar's own startup output.
  Note the broker is ephemeral — queued tasks are lost on instance recycle.
- **File uploads fail (app otherwise healthy):** expected until S3-compatible
  storage is wired — Plane needs `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (GCS
  HMAC keys or external S3) via `environment_variables`. This is Plane-specific and
  documented in the Configuration Guide's Pitfalls section.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history. A common cause is an invalid
  `application_version` — the upstream `makeplane/plane-aio-community` image has no
  `latest` tag (the module maps `latest`→`stable`, but a typo'd explicit tag 404s
  with MANIFEST_UNKNOWN).
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service
(including the RabbitMQ sidecar), Cloud SQL database, Secret Manager secrets, GCS
buckets (including the `storage` bucket), and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry, NFS/Redis host) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (AIO container + RabbitMQ sidecar), Cloud SQL (PostgreSQL 15), Redis, GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | `/health` passes; connection URLs composed; instance admin created via `/god-mode/` |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, broker, upload, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
