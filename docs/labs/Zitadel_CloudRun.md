---
title: "Zitadel on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Zitadel on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Zitadel on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Zitadel is an open-source, cloud-native identity and access management (IAM) platform
providing OpenID Connect, OAuth 2.0, SAML, and user/organization management. This lab
takes you through the full operational lifecycle of the **Zitadel on Cloud Run** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Zitadel's own IAM configuration (organizations, projects, OIDC/SAML applications). For
the complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and sign in with the seeded admin account.
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

1. In the RAD platform, open **Zitadel (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL for PostgreSQL 15 database
   with its Secret Manager secrets (`ZITADEL_MASTERKEY` and the initial admin password,
   plus the database password), a Cloud Storage bucket, builds the container image, and
   runs a one-shot database-initialisation job (`db-init`) that creates the application
   database and role — Zitadel then creates its own schema on first boot via
   `zitadel start-from-init`. First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates), and the first boot itself can take an additional **7–8 minutes**
   for schema setup and migrations before the health probe passes.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~zitadel" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Zitadel exposes an unauthenticated health endpoint:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/debug/healthz"   # expect 200
   ```

2. Retrieve the seeded initial admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-zitadel-admin-password" --project="$PROJECT"
   ```

   (Find the exact secret name with `gcloud secrets list --project="$PROJECT"
   --filter="name~zitadel"` if you don't already know the resource prefix.)

3. Open `$SERVICE_URL` in a browser and sign in to the Console with username
   `zitadel-admin` and the password from the previous step. Zitadel seeds this account
   with `PASSWORDCHANGEREQUIRED = false`, so you can sign in immediately. Once signed in,
   create a real administrator, then disable or restrict the seeded `zitadel-admin`
   account and configure your organizations, projects, and OIDC/SAML applications.

4. If you deploy behind a custom domain (`application_domains` / the load balancer), set
   `ZITADEL_EXTERNALDOMAIN` in `environment_variables` to that host and apply via
   **Update** — otherwise the OIDC issuer and Console redirects will point at the
   default `run.app` host and logins will fail.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted on
   the next apply). Zitadel is kept warm by default (`min_instance_count = 1`,
   `cpu_always_allocated = true`) so token endpoints have no cold-start latency; it is
   safe to raise `max_instance_count` since all state lives in PostgreSQL.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Zitadel applies its own schema migrations idempotently on start — there is no
   separate migrate step to run.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~zitadel"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   Do not rotate `ZITADEL_MASTERKEY` after first boot — it encrypts all data at rest, and
   rotating it makes previously-encrypted data (client secrets, key material)
   permanently unreadable.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=zitadel --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The `[cloud-entrypoint]` log lines show
   the resolved DB SSL mode and external domain — useful when diagnosing login failures:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50 \
     | grep cloud-entrypoint
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module also provisions an **uptime check**; confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Zitadel releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup probe
  targets `/debug/healthz` and allows roughly **7–8 minutes** on first boot for schema
  setup and migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login / token exchange fails after deploy:** the OIDC issuer and Console redirects
  are built from `ZITADEL_EXTERNALDOMAIN`. If you're behind a custom domain or load
  balancer and didn't set it to match, every login and token exchange will fail —
  set it in `environment_variables` and redeploy.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs. Note
  this job only creates the database/role — it does not create Zitadel's own schema
  (that happens in-container on start):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including the critical rule never to rotate
`ZITADEL_MASTERKEY` after first boot, and the mandatory PostgreSQL requirement).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; sign in to the Console with the seeded `zitadel-admin` account |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging (including `[cloud-entrypoint]` lines); review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, external-domain, database, init-job, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
