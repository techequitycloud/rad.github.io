---
title: "Infisical on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Infisical on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Infisical on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_CloudRun)**

## Overview

**Estimated time:** 45–75 minutes

Infisical is an open-source, end-to-end encrypted secrets management platform:
teams and CI/CD pipelines store, inject, and rotate application secrets from a
single platform. This lab takes you through the full operational lifecycle of the
**Infisical on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Infisical product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and bootstrap the first admin account.
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

1. In the RAD platform, open **Infisical (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database, its Secret Manager secrets (`ENCRYPTION_KEY`, `AUTH_SECRET`,
   `ADMIN_PASSWORD`, and the database password), builds the custom container
   image (wraps the official `infisical/infisical` image), and runs the
   `db-init` job. First deploys take roughly **15–30 minutes** (Cloud SQL
   creation and the custom image build dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~infisical" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Infisical
   exposes an unauthenticated status endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/status"   # expect HTTP 200 with a JSON body
   ```

2. **Bootstrap the first admin account.** Unlike apps that self-serve a signup
   page, Infisical's admin account is created headlessly by the
   `admin-bootstrap` initialization job — which does **not** run automatically on
   Cloud Run (init jobs there run strictly before the Service exists). Trigger it
   manually once the service is healthy:

   ```bash
   gcloud run jobs execute "${SERVICE}-admin-bootstrap" \
     --project="$PROJECT" --region="$REGION" --wait
   ```

   It is idempotent (`--ignore-if-bootstrapped`) and safe to re-run.

3. Retrieve the generated admin password and log in at `$SERVICE_URL`:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" \
       --filter="name~infisical-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   The admin email is the module's `admin_email` input (default
   `admin@techequity.cloud`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply).

3. **Update the application version tag** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds and a new
   revision rolls out. `"latest"` maps to a pinned known-good release as the
   Dockerfile build arg — set an explicit version tag to track a different
   Infisical release.

4. **Manage secrets and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~infisical"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + admin-bootstrap
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=infisical --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module can provision an
   **uptime check** via `uptime_check_config`; if enabled, confirm it is green
   under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Infisical releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe is **TCP** (not HTTP `/api/status`) by design — see the
  Configuration Guide's *Pitfalls* section for why.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` job completed successfully.
  Also check that `enable_cloudsql_volume = true` (the entrypoint's `sslmode`
  branching assumes the Auth Proxy socket).
- **`admin-bootstrap` job fails or an admin account never appears:** list
  executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap" \
    --project="$PROJECT" --region="$REGION"
  ```
  Remember this job does not run automatically on Cloud Run — see Task 2.
- **`REDIS_URL` / `REDIS_SENTINEL_HOSTS` / `REDIS_CLUSTER_HOSTS` must be defined
  crash on boot:** confirm `enable_redis` was forwarded correctly and, if
  `redis_auth` is set, that the Redis secret propagated (`secret_propagation_delay`).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `ENCRYPTION_KEY` after first
boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it (for example after manual changes that conflict
with the Terraform state), use **Purge** instead — it removes the deployment from
RAD's records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, builds the custom image, and runs `db-init` |
| 2 — Access & verify | Manual | Health check passes; manually trigger `admin-bootstrap` and log in with the generated admin password |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
