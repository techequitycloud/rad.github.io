---
title: "Keycloak on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Keycloak on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Keycloak on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Keycloak is an open-source identity and access management platform providing single sign-on (SSO), OIDC, and SAML for your applications. This lab takes you through the full operational lifecycle of the **Keycloak on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Keycloak product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the Keycloak admin console with the Secret Manager bootstrap credential and verify the service.
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

1. Click **Deploy** in the RAD platform top navigation, open **Keycloak (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (database password + bootstrap admin password),
   builds the production-optimized Keycloak container image with Cloud Build
   (`kc.sh build` → `start --optimized`), and runs a one-shot `db-init` job that
   creates the Keycloak database and role. Keycloak connects over **TCP to the
   database's private IP** (the JDBC driver cannot use the Cloud SQL socket). First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~keycloak" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. The OIDC discovery document of the built-in
   `master` realm is public and proves Keycloak is up **and** talking to its
   database (allow 60–120 seconds for a JVM cold start if the service scaled to
   zero):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     "$SERVICE_URL/realms/master/.well-known/openid-configuration"   # expect 200
   curl -s "$SERVICE_URL/realms/master/.well-known/openid-configuration" | head -c 300
   ```

   Note: Keycloak's `/health` endpoint lives on the management port 9000, which
   Cloud Run does not expose — the discovery document is the correct external check.

2. Open `${SERVICE_URL}/admin` in a browser to reach the admin console. Log in with
   the **bootstrap admin** — username `admin`, password from Secret Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~keycloak-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. **Immediate hardening:** the bootstrap admin is temporary by design. In the admin
   console create a permanent administrator (Users → Add user, assign the `admin`
   role), sign in as that user, then delete or disable the bootstrap `admin` user.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). For a
   production IdP set `min_instance_count = 1`: with `0`, the first SSO redirect
   after idle waits out a 60–120 s JVM cold start.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out. **Never
   downgrade** — Keycloak schema migrations are one-way.

4. **Manage secrets, jobs, and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~keycloak"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   ```

5. **Open a database session** for inspection or maintenance (Keycloak keeps all
   realms, clients, and users in PostgreSQL):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~keycloak" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The entrypoint prints a
   configuration summary (`KC_DB_URL`, `KC_HOSTNAME`, proxy settings) at every start:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation (watch memory — Keycloak is a JVM). The uptime check is
   disabled by default; enable `uptime_check_config` (path `/`) via **Update** and
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Keycloak releases.

- **Revision unhealthy / service won't serve:** the startup probe is **TCP on 8080**
  with a ~330-second budget for JVM start + first-boot schema migrations. Inspect
  the latest revision and its logs before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the `db-init` job completed, and the entrypoint log shows a
  `KC_DB_URL` pointing at the private IP. Keycloak connects over TCP —
  `enable_cloudsql_volume` must stay `false` (the JDBC driver cannot use the Cloud
  SQL Unix socket), and `vpc_egress_setting` must allow private-range egress.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
  `container_image_source` must be `custom` — the upstream image lacks the
  entrypoint that maps DB credentials and detects the hostname.
- **403 / permission errors:** verify the runtime service account's IAM roles.
- **App-specific — OIDC redirects go to the wrong host:** the entrypoint auto-detects
  the `run.app` URL as `KC_HOSTNAME`. If you front Keycloak with a load balancer or
  custom domain, set `KC_HOSTNAME` explicitly in `environment_variables` so issuer
  URLs and login redirects match the hostname users actually visit. (A 404 on
  `${SERVICE_URL}/health` is **not** a failure — health lives on the unexposed
  management port 9000.)

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets (bootstrap admin + database password),
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, builds the optimized image, and runs DB init |
| 2 — Access & verify | Manual | OIDC discovery returns 200; bootstrap admin login; permanent admin created |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, IAM, and hostname issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
