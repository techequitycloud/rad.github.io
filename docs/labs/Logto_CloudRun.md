---
title: "Logto on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Logto on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Logto on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Logto is an open-source identity provider — an Auth0 alternative that speaks OIDC
and OAuth 2.0, with sign-in flows, social/enterprise connectors, multi-tenancy, and
an admin console. This lab takes you through the full operational lifecycle of the
**Logto on Cloud Run** module on Google Cloud: deploy it, access and verify it, run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Logto product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including reaching the admin console for
  first-run setup.
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

1. In the RAD platform, open **Logto (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secret (the database password — Logto has no
   external application secret; its OIDC signing keys are generated into the
   database on first boot), a Cloud Storage bucket, builds the container image, and
   runs a one-shot database-initialisation job that creates the application role
   (with `CREATEROLE`) and database. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~logto" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Logto exposes an
   unauthenticated status endpoint that responds only once the core has booted and
   seeded its schema:

   ```bash
   curl -s "$SERVICE_URL/api/status"   # expect HTTP 200
   ```

2. **The admin console is not reachable at `$SERVICE_URL`.** Cloud Run publishes a
   single container port (3001, Logto core / OIDC), while the admin console —
   where you create the first administrator and register OIDC applications — runs
   on port 3002. To complete first-run setup you must front Logto with a proxy
   that routes to 3002, or temporarily deploy a second Cloud Run revision/service
   with `container_port = 3002` pointed at the same image and database. Plan this
   route **before** you need it; there is no `kubectl port-forward` equivalent on
   Cloud Run.

3. Once you can reach the admin console, create the first administrator account and
   register your first OIDC application. Note the registered redirect URI must use
   the same host as `ENDPOINT` (see Task 5) — a mismatch breaks every OAuth callback.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). `min_instance_count` defaults to `1` to avoid
   cold-start latency on OIDC requests; `0` is data-safe (all state is in Postgres)
   if you prefer to trade cold starts for cost.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Pin `application_version` to a specific release (e.g. `1.33`) in
   production rather than tracking `latest`.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~logto"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=logto --database=logto --project="$PROJECT"
   ```

   Never wipe or reset this database outside of an intentional restore — Logto's
   OIDC signing keys live only in it, and wiping it invalidates every issued token
   and registered client.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The entrypoint prints a
   `[cloud-entrypoint]` line reporting the resolved DB connection mode and
   `ENDPOINT`, which is the first thing to check when diagnosing a connection or
   issuer-URL problem:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. An **uptime check** is disabled by default
   (`uptime_check_config.enabled = false`); enable it with
   `path = "/api/status"` for production monitoring, then confirm it is green
   under Monitoring → Uptime checks and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Logto releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/api/status` and allows a wide first-boot window (60s initial
  delay + 30 retries) for the schema/OIDC-key seed step.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **OIDC / login callback errors:** confirm `ENDPOINT` matches the exact host the
  browser used to reach Logto — Logto builds its OIDC issuer and every absolute
  redirect URL from this value.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the DB password secret exists. Remember Logto's `slonik` driver cannot parse the
  Cloud SQL Unix-socket DSN — the entrypoint connects over the injected **private
  IP** (`DB_IP`) with `sslmode=no-verify` instead, even though
  `enable_cloudsql_volume` still injects the Auth Proxy sidecar for parity.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Admin console unreachable:** this is expected on the default `$SERVICE_URL` —
  see Task 2. The admin console (3002) is never published on the primary service.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to wipe the Cloud SQL database, since
Logto's only copy of its OIDC signing keys lives there).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database (and with it Logto's only copy of its OIDC signing keys),
Secret Manager secret, GCS bucket, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), a DB-password secret, a storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; reach the admin console via a separate route to create the first administrator |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, OIDC/callback, database, init-job, and admin-console-access issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
