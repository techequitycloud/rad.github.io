---
title: "Hasura on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Hasura on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Hasura on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Hasura is an open-source engine that gives you an instant, realtime GraphQL and REST
API over a PostgreSQL database, with role-based authorization and a built-in admin
console. This lab takes you through the full operational lifecycle of the **Hasura on
Cloud Run** module on Google Cloud: deploy it, access and verify it, open the console
and run a GraphQL query, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Hasura product internals. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Retrieve the admin secret and open the Hasura console.
- Track a table and run a GraphQL query end to end.
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

1. In the RAD platform, open **Hasura (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Hasura_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (`HASURA_GRAPHQL_ADMIN_SECRET` and the database
   password), builds the container image (a thin wrapper over `hasura/graphql-engine`),
   and runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~hasura" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Hasura exposes a
   public health endpoint that returns 200 only when the engine is up and connected to
   PostgreSQL:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/healthz"   # expect 200
   ```

2. Retrieve the admin secret from Secret Manager — you need it for the console and for
   every GraphQL/metadata API call:

   ```bash
   ADMIN_SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-secret" --format="value(name)" --limit=1)
   ADMIN=$(gcloud secrets versions access latest --secret="$ADMIN_SECRET_NAME" --project="$PROJECT")
   echo "Admin secret: $ADMIN"
   ```

3. Open `$SERVICE_URL/console` in a browser. Hasura prompts for the admin secret —
   paste the value from step 2. The console opens on the **Data** tab, connected to
   your Cloud SQL database (the `default` source).

---

## Task 3 — Worked example: track a table and run a GraphQL query [Manual]

1. **Create a table.** In the console, go to **Data → default → public → Create Table**.
   Name it `todos` with columns `id` (Integer, auto-increment, primary key) and
   `title` (Text). Click **Add Table**. (Prefer SQL? Open **Data → SQL**, run
   `CREATE TABLE todos (id serial primary key, title text);`, and tick
   *Track this table*.)

2. **Track the table.** If you created it via SQL, Hasura lists it under
   *Untracked tables* — click **Track**. Tracking is what exposes the table through the
   GraphQL API; it writes an entry into Hasura's metadata catalog (stored in Postgres,
   so it survives revisions and restarts).

3. **Insert a row** via the API (using the admin secret as the `x-hasura-admin-secret`
   header):

   ```bash
   curl -s "$SERVICE_URL/v1/graphql" \
     -H "x-hasura-admin-secret: $ADMIN" \
     -H 'Content-Type: application/json' \
     -d '{"query":"mutation { insert_todos_one(object: {title: \"Ship the docs\"}) { id title } }"}'
   ```

4. **Run a GraphQL query** to read it back:

   ```bash
   curl -s "$SERVICE_URL/v1/graphql" \
     -H "x-hasura-admin-secret: $ADMIN" \
     -H 'Content-Type: application/json' \
     -d '{"query":"query { todos { id title } }"}'
   # => {"data":{"todos":[{"id":1,"title":"Ship the docs"}]}}
   ```

   You can also run the same query interactively in the console's **API** (GraphiQL)
   tab — it sends the admin-secret header for you.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted on
   the next apply). Hasura scales horizontally safely because all state is in Postgres;
   set `min_instance_count = 1` to remove cold-start latency for a latency-sensitive
   API.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Your tracked-table metadata persists in the database across the upgrade.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~hasura"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=hasura --database=hasura --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module also provisions an **uptime check** targeting
   `/healthz`; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Hasura releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm the DSN was assembled. The startup probe targets
  `/healthz`; a database connection failure keeps the revision from becoming Ready.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`/console` or `/v1/graphql` returns 401:** you are missing or mis-sending the admin
  secret. Re-fetch it (Task 2 step 2) and send it as `x-hasura-admin-secret`. Never
  point health probes at these paths — use `/healthz`.
- **Database connection errors** (`connection refused`, `no pg_hba entry`): confirm the
  Cloud SQL instance is `RUNNABLE`, the DB password secret exists, and the
  initialisation job completed. On Cloud Run the DSN uses the socket form; a `prebuilt`
  image bypasses the entrypoint and has no DSN at all.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping probes on `/healthz` and never exposing the admin secret).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; retrieve the admin secret; open the console |
| 3 — Worked example | Manual | Track a table and run an insert + GraphQL query end to end |
| 4 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose revision, auth (401), database, init-job, build, and IAM issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
