---
title: "Tolgee on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Tolgee on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Tolgee on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Tolgee is an open-source, developer-friendly localization (i18n) and translation
management platform built on Spring Boot. This lab takes you through the full
operational lifecycle of the **Tolgee on Cloud Run** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Tolgee product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its Liquibase-migrated database.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
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

1. In the RAD platform, open **Tolgee (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (the auto-generated initial admin
   password, the JWT signing secret, and the database password), and a Cloud
   Storage bucket for optional file storage. There is no separate database
   initialisation job to wait on beyond role/database creation — Tolgee creates
   and migrates its entire schema with Liquibase on first boot. First deploys
   take roughly **15–30 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~tolgee" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and Liquibase migrations have completed.
   Tolgee's Spring Boot Actuator health endpoint responds only once the
   application has fully started and PostgreSQL is reachable:

   ```bash
   curl -s "$SERVICE_URL/actuator/health"   # expect {"status":"UP",...}
   ```

   Allow several minutes on first boot — Spring Boot plus first-run Liquibase
   migrations start more slowly than a typical Node app.

2. Retrieve the generated initial admin password and sign in:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee AND name~admin-password"
   gcloud secrets versions access latest \
     --secret="<admin-password-secret-name>" --project="$PROJECT"
   ```

   Open `$SERVICE_URL` in a browser and sign in as the initial owner —
   `admin@techequity.cloud` by default (`TOLGEE_AUTHENTICATION_INITIAL_USERNAME`)
   — with the password retrieved above. Change the password immediately and
   configure any additional auth providers (Google/OAuth2/SSO) from the Tolgee UI
   before going live, especially if `ingress_settings` is left at `all`.

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
   reverted on the next apply). Leave `min_instance_count = 1` and
   `cpu_always_allocated = true` unless you have a purely interactive deployment
   with no bulk machine-translation, import, or deletion jobs — those run
   asynchronously in-process after the request returns and need allocated CPU to
   finish.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Tolgee applies its Liquibase changesets on every startup, so the
   schema upgrades automatically — pin `application_version` to a known-good
   release in production rather than tracking `latest`.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee"
   ```

   The JWT signing secret (`TOLGEE_AUTHENTICATION_JWT_SECRET`) is immutable in
   practice — only rotate it during a planned maintenance window, since rotating
   it immediately invalidates every active user session.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=tolgee --database=tolgee --project="$PROJECT"
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
   CPU / memory utilisation. The module also provisions an **uptime check**
   against `/actuator/health` (when the service is publicly reachable); confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Tolgee releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/actuator/health` with a
  wide first-boot window (Liquibase migrations run on a fresh database on first
  boot).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`.
  Tolgee's JDBC driver cannot use a Cloud SQL Unix socket, so on Cloud Run it
  connects over the instance's **private IP** with `sslmode=require` — verify
  `enable_cloudsql_volume` is still `false` (the module default); flipping it to
  `true` points the app at a socket directory the driver cannot use and breaks
  the connection.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Database role/schema not created:** there is no dedicated init job to
  re-run — the foundation's `create-db-and-user.sh` step creates the role and
  database, then Tolgee's own Liquibase migrations build the schema on boot.
  List the setup job and its executions if the database looks empty:
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~tolgee"
  gcloud run jobs executions list --job=<job-name> --project="$PROJECT" --region="$REGION"
  ```
- **Users unexpectedly logged out:** check whether `TOLGEE_AUTHENTICATION_JWT_SECRET`
  was rotated — rotating it after first boot invalidates every active session.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the memory floor for Liquibase migrations and why
`enable_cloudsql_volume` must stay `false` on Cloud Run).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and the Cloud Storage bucket.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and a storage bucket; Tolgee self-migrates via Liquibase |
| 2 — Access & verify | Manual | Health check passes; sign in with the generated initial admin credential and change the password |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database connectivity, setup-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
