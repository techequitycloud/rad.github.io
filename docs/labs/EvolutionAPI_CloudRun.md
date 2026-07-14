---
title: "Evolution API on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Evolution API on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Evolution API on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Evolution API is an open-source Node.js WhatsApp Business API gateway (built on the
Baileys library) that provisions WhatsApp instances, sends and receives messages, and
exposes a REST API plus a manager UI for wiring WhatsApp into other systems. This lab
takes you through the full operational lifecycle of the **Evolution API on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Evolution API / WhatsApp product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete first-run WhatsApp setup.
- Perform day-2 operations — inspect, update, and manage secrets, cache, and backups.
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

1. In the RAD platform, open **Evolution API (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service (pinned to a single always-warm
   instance), a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (the auto-generated `AUTHENTICATION_API_KEY` admin key and the database password),
   a Cloud Storage data bucket, a Filestore NFS instance (which also hosts the default
   Redis endpoint), builds the container image, and runs a one-shot database
   initialisation job. First deploys take roughly **20–35 minutes** (Cloud SQL and
   NFS creation dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~evolutionapi" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Evolution API's startup and liveness probes target
   the root `/` — an unauthenticated status endpoint that responds once the server is
   up (allow up to ~7 minutes on first boot while Prisma migrations run):

   ```bash
   curl -s "$SERVICE_URL/"   # expect a JSON status payload, not a connection error
   ```

2. Retrieve the auto-generated global admin key from Secret Manager:

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT")
   echo "$API_KEY"
   ```

3. Open `$SERVICE_URL/manager` in a browser (or call the REST API directly) using
   `$API_KEY` as the `apikey` header, and create your first WhatsApp instance:

   ```bash
   curl -s -X POST "$SERVICE_URL/instance/create" \
     -H "apikey: $API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"lab-instance","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```

4. Fetch the connection QR code and scan it from WhatsApp on your phone (**Linked
   Devices → Link a Device**) to connect the number:

   ```bash
   curl -s "$SERVICE_URL/instance/connect/lab-instance" -H "apikey: $API_KEY"
   ```

   **Never rotate `AUTHENTICATION_API_KEY` after this point** — rotating it makes
   every already-provisioned WhatsApp instance unreachable and returns `401` to every
   client still holding the old key.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** WhatsApp (Baileys) socket sessions are held
   in the instance's memory and are not shared across replicas — `min_instance_count`
   and `max_instance_count` are pinned to `1` by design. Raising `max_instance_count`
   fragments live connections and duplicates webhook deliveries; leave it alone.

3. **Update the application version** by changing the version input (default
   `v2.1.1`) in the RAD platform and applying it via **Update** — a new image builds
   and Prisma migrations run again on the next boot.

4. **Manage secrets, cache, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~evolutionapi"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"          # db-init + any scheduled jobs
   # Confirm the Redis cache URI resolved in the running revision:
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -i redis
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=evolution --database=evolution --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The entrypoint emits
   `[cloud-entrypoint]` markers that confirm the resolved DB/Redis/URL config on boot:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), and CPU / memory utilisation (the instance
   stays warm at `min=1`, so expect a small steady baseline rather than scale-to-zero
   behaviour). The module also provisions an **uptime check**; confirm it is green
   under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Evolution API releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/` and allows up to ~7 minutes on first boot (60s initial delay plus
  a 30-retry window while Prisma migrates).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Redis cache silently disabled:** if `enable_redis=true` but the cache URI env var
  is blank, check that either `enable_nfs=true` (so the NFS server IP is used) or an
  explicit `redis_host` is set.
- **401 on every WhatsApp API call:** the `apikey` header is missing/wrong, or
  `AUTHENTICATION_API_KEY` was rotated after instances were already provisioned — the
  fix is to re-provision the affected WhatsApp instances, not to rotate back.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including the critical rule never to rotate
`AUTHENTICATION_API_KEY` or raise `max_instance_count` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, NFS,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (pinned single instance), Cloud SQL (PostgreSQL 15), NFS/Redis, secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; retrieve the admin API key; create and connect a WhatsApp instance via QR code |
| 3 — Operate | Manual | Inspect revisions, update version, manage secrets/cache/jobs, DB access — do not scale beyond one instance |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, Redis, auth-key, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
