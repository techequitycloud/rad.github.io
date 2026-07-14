---
title: "Azimutt on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Azimutt on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Azimutt on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Azimutt is an open-source, next-generation database-schema explorer and ERD
(entity relationship diagram) tool for real-world databases, built with
Elixir/Phoenix. This lab takes you through the full operational lifecycle of
the **Azimutt on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Azimutt product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and create the first Azimutt account.
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

1. In the RAD platform, open **Azimutt (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY_BASE` and the database
   password), a Cloud Storage bucket, builds the container image (a thin wrapper
   FROM `ghcr.io/azimuttapp/azimutt`), and runs a one-shot database-initialisation
   job that creates the application role and database. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~azimutt" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Azimutt has no
   dedicated health JSON endpoint — the startup and readiness probes target the
   Phoenix root `/`, which only returns `200` once the server has booted,
   applied its migrations, and connected to Postgres:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Azimutt shows its sign-up
   page — no pre-seeded admin credential exists in Secret Manager. Create your
   first account with an email and password. Sign-up is **open by default**, so
   after creating your account, restrict further access (custom domain + IAP, or
   Azimutt's own auth settings via `environment_variables`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Unlike apps with an in-memory job queue, Azimutt
   uses PostgreSQL (Oban) for background work, so scaling beyond one instance
   needs no Redis. Note that `min_instance_count = 0` (the default) enables
   scale-to-zero; set `1` to avoid the few seconds of cold-start latency after
   idle.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Migrations run automatically on every boot
   (`/app/bin/migrate && /app/bin/server`), so an upgrade applies its schema
   changes on start — allow extra time on the first boot after a version bump.
   Azimutt publishes no `:latest` tag (`application_version = "latest"` maps to
   its `main` tag); pin to a specific release in production.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~azimutt"
   ```

   Never rotate `SECRET_KEY_BASE` outside a maintenance window — rotating it
   invalidates every active session cookie and signs out all users.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=azimutt --database=azimutt --project="$PROJECT"
   ```

6. **File uploads are ephemeral by default.** With the default
   `FILE_STORAGE_ADAPTER = local`, uploads are written to the container's local
   disk, not the provisioned Cloud Storage bucket — they do not survive a
   redeploy or a scale-to-zero cold start. Project data itself (schemas,
   diagrams, layouts, users) lives safely in Postgres.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The `cloud-entrypoint` lines
   show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module can provision an **uptime check** (when
   enabled); confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Azimutt releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe targets `/` with a 60-second initial delay — allow ~1–2 minutes
  on first boot for migrations to finish before the endpoint binds.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`.
  Azimutt connects over the instance's **private IP with SSL**
  (`DATABASE_ENABLE_SSL=true`) — Ecto/postgrex cannot parse the Cloud SQL socket
  DSN, so the socket mount (`enable_cloudsql_volume = true`) exists solely for
  the `db-init` job, not the running app.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log
  — the base tag comes from the `AZIMUTT_VERSION` build arg (`latest` maps to
  `main`).
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`SECRET_KEY_BASE` after first boot, and why `db_name`/`db_user` are immutable
after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS bucket, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check (`/`) passes; create the first Azimutt account in the UI |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
