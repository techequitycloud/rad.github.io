---
title: "Coder on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Coder on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Coder on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Coder is an open-source, self-hosted platform for provisioning remote development environments (workspaces) defined as code with Terraform. This lab takes you through the full operational lifecycle of the **Coder on Cloud Run** module on Google Cloud: deploy the control plane, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Coder product features such as templates and workspaces. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the Coder control plane, create the first admin account, and verify health.
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

1. Click **Deploy** in the RAD platform top navigation, open **Coder (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager password secret, a dedicated GCS bucket, mirrors the
   `ghcr.io/coder/coder` base image into Artifact Registry, builds the custom
   entrypoint image with Cloud Build, and runs a one-shot database-initialisation job.
   Coder applies its own schema migrations on first server boot. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~coder" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Coder serves an unauthenticated health endpoint at
   `/healthz` (HTTP 200 once the server is up — allow a minute or two on a fresh
   deploy while first-boot schema migrations run):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"
   curl -s "$SERVICE_URL/api/v2/buildinfo"     # returns the deployed Coder version
   ```

2. Open `$SERVICE_URL` in a browser. On first boot Coder presents the **setup page**
   — create the initial admin (owner) account with your name, email, and password.
   **Do this promptly**: the setup page is publicly reachable until the first account
   exists. The database password (the only credential stored in Secret Manager) can
   be retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~coder" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. **Post-deploy hardening and next steps:** consider fronting the service with IAP or
   Cloud Armor for a private team, and note that running actual workspaces requires a
   day-2 step — create a Coder template (Terraform) pointing at a compute target such
   as a GKE cluster or GCE VMs, and give the provisioner credentials for it. The
   control plane alone runs no workspaces.

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
   Keep `min_instance_count >= 1` and `cpu_always_allocated = true`: Coder's
   in-process provisioner daemons poll PostgreSQL for pending workspace builds, and
   scale-to-zero or CPU throttling silently stalls them.

3. **Update the application version** by changing the version input via **Update** on
   the deployment details page; a new image builds and a new revision rolls out.
   Coder's tags are semver-prefixed (e.g. `v2.24.1`); the module maps `latest` to a
   pinned tag. Schema migrations run automatically on the new revision's first boot.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~coder"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~coder"
   ```

5. **Open a database session** for inspection or maintenance (PostgreSQL):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=coder --database=coder --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The custom entrypoint logs the
   resolved PostgreSQL host and access URL at every start:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (should hold steady at the
   warm minimum), and CPU / memory utilisation. If you enabled `uptime_check_config`,
   confirm the check is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Coder releases.

- **Revision unhealthy / service won't serve:** the startup probe targets `/healthz`
  with a 60-second initial delay and a generous failure threshold to cover first-boot
  schema migration. Inspect the latest revision and its logs before concluding the
  service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. The
  entrypoint log line `PG host: <ip> (sslmode=require)` shows what it resolved — a
  URL-parse error in the logs means an explicit `CODER_PG_CONNECTION_URL` override is
  malformed (the module's assembled URL percent-encodes the password automatically).
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
  The `container_image_source` must be `custom` — the upstream Coder image lacks
  the entrypoint that assembles the DB connection URL and access URL. A
  `MANIFEST_UNKNOWN` on the base image means a non-existent version tag — Coder tags
  are semver-prefixed (`vX.Y.Z`).
- **Workspace builds queued but never start:** this is the Coder-specific trap. The
  provisioner daemons run *inside* `coder server` and poll the database — if the
  service was scaled to zero (`min_instance_count = 0`) or flipped to request-based
  billing (`cpu_always_allocated = false`), they stall between requests. Restore the
  defaults (`min = 1`, always-allocated) via the RAD Update flow. Also verify
  `CODER_ACCESS_URL` matches the URL developers actually use — a mismatch breaks
  workspace agent connections.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), GCS bucket, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | `/healthz` returns 200; create the first admin (owner) account |
| 3 — Operate | Manual | Inspect revisions, scale (keep min=1/always-on), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, stalled-provisioner, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
