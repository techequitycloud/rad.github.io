---
title: "Gotify on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Gotify on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gotify on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Gotify is an open-source, self-hosted server for real-time push notifications:
applications send messages over a simple REST API and clients receive them instantly
over WebSocket. This lab takes you through the full operational lifecycle of the
**Gotify on Cloud Run** module on Google Cloud: deploy it, access and verify it, send
and receive a live notification, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Gotify product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and retrieve the generated admin password.
- Send a message via the REST API and receive it over the WebSocket stream.
- Perform day-2 operations — inspect, update, and manage secrets and backups.
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
- A WebSocket client for the worked example — `websocat` (recommended) or `curl` 8.x.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Gotify (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (the admin password and the database password),
   builds the custom container image (wrapping `ghcr.io/gotify/server`), and runs a
   one-shot database-initialisation job. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gotify" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Gotify exposes a
   public health endpoint that reports both the server and the database:

   ```bash
   curl -s "$SERVICE_URL/health"    # expect {"health":"green","database":"green"}
   ```

2. Retrieve the generated admin password from Secret Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~gotify-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in as **`admin`** with that password.
   Change the password immediately under **Users** — the bootstrap password is applied
   only on the first database initialisation and is not reset by later deploys.

---

## Task 3 — Send and receive a notification [Manual]

This is the core Gotify workflow: an *application token* sends messages; a *client
token* subscribes to them.

1. **Create an application** (in the UI: **Apps → Create Application**), or via the
   REST API using HTTP basic auth as the admin user. Capture the returned app token:

   ```bash
   ADMIN_PASS='<paste-the-admin-password>'
   APP_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-app","description":"lab notifications"}' \
     "$SERVICE_URL/application" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "App token: $APP_TOKEN"
   ```

2. **Create a client** to receive messages, and capture its token:

   ```bash
   CLIENT_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-client"}' \
     "$SERVICE_URL/client" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "Client token: $CLIENT_TOKEN"
   ```

3. **Subscribe to the stream** in one terminal (leave it running). Gotify streams new
   messages over WebSocket at `/stream`:

   ```bash
   WS_URL="${SERVICE_URL/https:/wss:}/stream?token=$CLIENT_TOKEN"
   websocat "$WS_URL"          # or: curl --include -N "$SERVICE_URL/stream?token=$CLIENT_TOKEN"
   ```

4. **Send a message** from another terminal using the app token. It should appear in
   the stream terminal within a second:

   ```bash
   curl -s "$SERVICE_URL/message?token=$APP_TOKEN" \
     -F "title=Deploy complete" -F "message=Gotify is live on Cloud Run" -F "priority=5"
   ```

   The stream terminal prints the JSON message. That end-to-end path — REST in,
   WebSocket out — is exactly what your applications and clients will use.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** Gotify's message bus is in-process, so a
   client only receives messages delivered to the instance it is connected to. The
   module fixes `min = max = 1`; changing that without an external fan-out layer drops
   messages for some subscribers.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Gotify runs its GORM auto-migration on startup, so schema changes apply
   automatically.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gotify"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=gotify --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory utilisation.
   The module also provisions an **uptime check** against `/health`; confirm it is
   green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gotify releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/health` and allows ~5 minutes on first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret exists, and the initialisation job completed successfully. Gotify
  logs the DB host/port/name on startup.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **`403 invalid API token` on send/receive:** re-check the token — app tokens send
  (`/message`), client tokens subscribe (`/stream`); they are not interchangeable.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `max_instance_count` must stay at 1).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the Cloud Run service, Cloud SQL database, Secret Manager secrets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; log in as `admin` with the generated password |
| 3 — Send & receive | Manual | Create app + client tokens, POST a message, receive it over WebSocket |
| 4 — Operate | Manual | Inspect revisions, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and token issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
