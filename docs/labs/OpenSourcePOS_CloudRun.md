---
title: "OpenSourcePOS on Cloud Run — Lab Guide"
description: "Hands-on lab: deploy Open Source POS on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# OpenSourcePOS on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Open Source Point of Sale (OSPOS) is a free, open-source, web-based retail point
of sale — sales, items, customers, suppliers, receipts and reporting. This lab
takes you through the full operational lifecycle of the **OpenSourcePOS on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on OpenSourcePOS product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and confirm the schema loaded into Cloud SQL.
- Perform day-2 operations — inspect, scale, update, and manage secrets, uploads and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL, Artifact Registry, and shared
  service accounts this module depends on). You do not need to deploy this
  yourself first — the platform automatically detects whether it already exists
  in the target project and provisions it before this module if not (see Task
  1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Solutions → Solution Catalog → RAD modules**, then open **OpenSourcePOS (Cloud Run)** from the **Platform Modules** list, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenSourcePOS_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its password in Secret Manager, a `storage` Cloud Storage bucket
   (mounted at `/app/public/uploads` for item pictures and the company logo) and
   a generic `data` bucket, builds the custom container image (wrapping
   `jekkos/opensourcepos:3.4.1`), and runs the two-stage initialization chain:
   `db-init` (creates the database, user and grants) followed by `schema-load`
   (loads the schema that ships inside the OpenSourcePOS image). Cloud SQL
   creation and the image build dominate a first deploy.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ospos" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service answers at the document root, which is what both health
   probes check:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Confirm the container started against Cloud SQL rather than a fallback. The
   wrapper logs its connection target on every start:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --limit=200 | grep "\[startup\]"
   ```

   Expect `OpenSourcePOS pointed at <private-ip>:3306/<db-name> as <db-user>`.

3. Confirm the schema loaded. The `schema-load` job's log ends with
   `Schema loaded: N tables in <db-name>` on the first deploy, or
   `Schema already present ... -- nothing to do` on later applies:

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~schema-load"
   ```

4. Open `$SERVICE_URL` in a browser and sign in as the administrator (username
   `admin`) created by the bundled schema. **Change the administrator password
   immediately** — the module does not randomise it.

5. Upload a company logo or an item picture, then confirm it landed in the
   `storage` bucket (and therefore survives a restart):

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --format="value(name)" --filter="name~storage" --limit=1)
   gcloud storage ls -r "gs://$BUCKET/"
   ```

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
   reverted on the next apply). For a till in daily use set
   `min_instance_count = 1` so no sale waits on a cold start. Running more than
   one instance is safe: sessions are stored in MySQL.

3. **Update the application version** by changing `application_version` to
   another exact release tag of `jekkos/opensourcepos` and applying it via
   **Update**; a new image builds and a new revision rolls out. Never use
   `latest`. Note that `schema-load` only loads the schema into an empty
   database — it does not migrate an existing one between releases.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # User and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ospos" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
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
   request count, request latency, instance count (scaling behaviour), and CPU /
   memory utilisation. The uptime check is **disabled** by default; enable it with
   `uptime_check_config` if you want one, then confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OpenSourcePOS releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. Both
  probes `GET /`; the startup probe allows 20 failures at a 15-second period.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Container exits with `FATAL: DB_... is empty or unset`:** the wrapper refuses
  to start when a database variable is blank, because OpenSourcePOS would
  otherwise silently use the `localhost` credentials baked into the image. Check
  that `db_host_env_var_name` is still `DB_IP` and that the database password
  secret exists.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and `db-init` completed before `schema-load`.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-schema-load" \
    --project="$PROJECT" --region="$REGION"
  ```
  `schema-load` fails explicitly if the load reports success but the database
  still has no tables.
- **Uploaded pictures disappear after a restart:** `enable_gcs_storage_volume`
  has been turned off, so uploads went to the container's ephemeral disk.
- **Image build failed:** review Cloud Build history for the failed build's log,
  and check that `application_version` names a tag that exists on
  `jekkos/opensourcepos`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets (including uploaded
pictures), and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), the `storage` and `data` buckets, and runs the `db-init` → `schema-load` init chain |
| 2 — Access & verify | Manual | `[startup]` log line names Cloud SQL; schema loaded; sign in as `admin` and change the password; upload lands in the `storage` bucket |
| 3 — Operate | Manual | Inspect revisions, scale (min 1 for a till), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; optionally enable the uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, empty-variable refusal, database, init-job, upload and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
