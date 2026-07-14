---
title: "Langfuse on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Langfuse on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Langfuse on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Langfuse is an open-source LLM engineering and observability platform — tracing, prompt
management, evaluations, and metrics for applications built on large language models. This
lab takes you through the full operational lifecycle of the **Langfuse on Cloud Run** module
on Google Cloud: deploy it, sign up the first user, generate an API key, send a trace, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
Langfuse product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete the first-user signup.
- Create an organization/project, generate an API key, and send your first trace.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL, Artifact
  Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Langfuse (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are
   enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database with
   its Secret Manager secrets (`NEXTAUTH_SECRET`, `SALT`, and the database password), a Cloud
   Storage bucket, builds the container image (a thin wrapper on `langfuse/langfuse:2`), and
   runs a one-shot database-initialisation job that creates the role and database. Langfuse
   then applies its schema via `prisma migrate deploy` on first boot. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the commands keep
   working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~langfuse" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Langfuse exposes an
   unauthenticated health endpoint that returns 200 only when the server is fully initialised
   and PostgreSQL is reachable:

   ```bash
   curl -s "$SERVICE_URL/api/public/health"   # expect an HTTP 200 with a small JSON body
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Langfuse shows a **Sign up** page —
   there is no pre-seeded admin credential. Enter your name, email, and a password and submit;
   **the first user to sign up becomes the instance owner.** Log in.

3. After the owner account is created, consider disabling open sign-up by setting
   `AUTH_DISABLE_SIGNUP = "true"` in `environment_variables` and applying it via **Update**.

---

## Task 3 — Create a project & send a trace [Manual]

1. In the Langfuse UI, create an **Organization**, then a **Project** inside it. Langfuse
   scopes traces, prompts, and API keys to a project.

2. Open **Project → Settings → API Keys** and click **Create new API key**. Copy the **Public
   Key** (`pk-lf-...`) and **Secret Key** (`sk-lf-...`) — the secret is shown only once.

3. Send your first trace directly to the public ingestion API with `curl` (Basic auth =
   `public:secret`). This is the same endpoint the Langfuse SDKs use:

   ```bash
   PUBLIC_KEY="pk-lf-..."
   SECRET_KEY="sk-lf-..."
   TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

   curl -s -u "$PUBLIC_KEY:$SECRET_KEY" \
     -X POST "$SERVICE_URL/api/public/ingestion" \
     -H "Content-Type: application/json" \
     -d '{
       "batch": [{
         "id": "'"$(uuidgen)"'",
         "type": "trace-create",
         "timestamp": "'"$TS"'",
         "body": { "id": "'"$(uuidgen)"'", "name": "lab-hello-trace", "input": "ping" }
       }]
     }'
   ```

   A `207`/`200` response with a `successes` array confirms ingestion. Refresh **Tracing** in
   the UI — the `lab-hello-trace` entry should appear within a few seconds.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment
   details page — the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `min_instance_count = 1` and `cpu_always_allocated = true` so background processing keeps
   running between requests.

3. **Update the application version** by changing the version input in the RAD platform and
   applying it via **Update**; a new image builds and a new revision rolls out. Langfuse runs
   `prisma migrate deploy` on boot, so a version bump applies schema changes automatically —
   allow extra startup time on the first boot after an upgrade.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~langfuse"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=langfuse --database=langfuse --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count,
   request latency (P50/P95/P99), instance count (scaling behaviour), and CPU / memory
   utilisation. If you enabled an **uptime check**, confirm it is green under Monitoring →
   Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with Langfuse releases.

- **Revision unhealthy / `Invalid environment variables`:** Langfuse's zod validation refuses
  to boot if `NEXTAUTH_SECRET` or `SALT` is missing. Confirm both secrets exist and are injected:
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~secret-key OR name~superuser-password"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
  The startup probe targets `/api/public/health` and allows a generous window on first boot for
  Prisma migrations.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB password
  secret exists, and the `db-init` job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Migrations didn't run:** Langfuse runs `prisma migrate deploy` on start (not in a separate
  job). If the schema looks empty, check the service logs for the migration output on boot.
- **Image build failed:** review Cloud Build history for the failed build's log. Note the image
  is pinned to the **v2** line via the `LANGFUSE_VERSION` build ARG — a v3 tag would break.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including the critical rule never to rotate `NEXTAUTH_SECRET` or `SALT` after first boot).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example
after manual changes that conflict with the Terraform state), use **Purge** instead — it removes
the deployment from RAD's records **without** destroying the cloud resources. Delete removes
everything the module created — the Cloud Run service, Cloud SQL database, Secret Manager
secrets, GCS bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; sign up the first user (becomes owner) and log in |
| 3 — Project & trace | Manual | Create an org/project, generate an API key, send a trace via curl |
| 4 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose secret/env, database, init-job, migration, build, and IAM issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
