---
title: "SimpleRisk on Cloud Run — Lab Guide"
description: "Hands-on lab: deploy SimpleRisk on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# SimpleRisk on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

SimpleRisk is an open-source governance, risk and compliance (GRC) platform —
a risk register with scoring, mitigation planning, management reviews and an
audit history. This lab takes you through the full operational lifecycle of the
**SimpleRisk on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on SimpleRisk product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the running service and create the SimpleRisk administrator account.
- Perform day-2 operations — inspect, scale, update, and manage secrets, storage and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL for MySQL, Artifact Registry, and
  shared service accounts this module depends on). You do not need to deploy
  this yourself first — the platform automatically detects whether it already
  exists in the target project and provisions it before this module if not (see
  Task 1).
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

1. In the RAD platform, open **Solutions → Solution Catalog → RAD modules**, then open **SimpleRisk (Cloud Run)** from the **Platform Modules** list, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   and its password secret, a `storage` bucket mounted with GCS FUSE at
   `/var/www/simplerisk/files`, builds the wrapper container image, and runs the
   two-stage initialization chain: `db-init` (creates the database, user and
   grants) followed by `schema-load` (loads SimpleRisk's schema into the empty
   database). First deploys take roughly **15–25 minutes** (Cloud SQL creation and
   the image build dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~simplerisk" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service answers on its URL:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. **Create the administrator account straight away.** Open `$SERVICE_URL` in a
   browser. SimpleRisk ships no default credentials — on first access it shows a
   **Default Admin Account Creation** form, and whoever submits it becomes the
   administrator. The service is public by default, so do this as soon as the
   deployment finishes. (To keep the URL private while you work, set
   `ingress_settings = "internal-and-cloud-load-balancing"` or `enable_iap = true`
   — see the Configuration Guide.)

3. Log in with the account you created and add a test risk. Then confirm the
   schema really is in Cloud SQL — `schema-load` reports the table count it found
   or loaded:

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~simplerisk"
   gcloud logging read \
     'resource.type="cloud_run_job" AND textPayload:"tables"' \
     --project="$PROJECT" --limit=5 --format="value(textPayload)"
   ```

   Expect a line such as `Schema loaded: 154 tables in ...` on the first deploy,
   or `Schema already present ... -- nothing to do` on later applies.

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
   reverted on the next apply). Sessions are stored in the database, so more than
   one instance is safe.

3. **Update the application version** by changing `application_version` to
   another dated SimpleRisk tag and applying it via **Update**; a new image
   builds `FROM simplerisk/simplerisk:<version>` and a new revision rolls out.
   Always change the tag — rebuilding under the same tag produces no new revision.

4. **Manage secrets, storage and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~simplerisk"
   gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep -i simplerisk
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. simpleriskdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^simplerisk" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. Each container start logs the
   database it rendered into `config.php` (`config.php rendered against Cloud SQL
   at ...`):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and CPU /
   memory utilisation. An uptime check is created only when it is enabled and
   `min_instance_count` is at least `1`; if so, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with SimpleRisk releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs. The entrypoint exits with `DB_IP is not set` (or `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`) when a database variable is missing — check that
  `db_host_env_var_name` is still `DB_IP`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **The page loads but nothing can be saved, or login fails with a database
  error:** the HTTP health probes pass without touching the database, so a broken
  database connection does not mark the service unhealthy. The usual cause is a
  password mismatch after `database_password_length` was changed. Re-run the
  `db-init` job, which resets the user's password from Secret Manager:
  ```bash
  gcloud run jobs execute "$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~db-init" --format="value(metadata.name)" --limit=1)" \
    --project="$PROJECT" --region="$REGION" --wait
  ```
- **`schema-load` failed:** read its execution logs. Note that it reports
  `database not reachable after 60s` for **any** failed connection, including an
  authentication failure — check the password before the network.
  ```bash
  gcloud run jobs executions list --job="$(gcloud run jobs list --project="$PROJECT" \
    --region="$REGION" --filter="metadata.name~schema-load" --format="value(metadata.name)" --limit=1)" \
    --project="$PROJECT" --region="$REGION"
  ```
- **The administrator form was already used:** someone reached the URL first.
  Restrict access first (Task 2), then delete the deployment and deploy it again
  so the schema is loaded into a fresh database with no administrator.
- **A configuration change did not reach the running service:** if you rebuilt
  the image without changing `application_version`, no new revision was created.
  Change the tag and apply again.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). Delete removes everything the module created — the Cloud Run service,
the SimpleRisk database and user, the database password secret, the GCS buckets
(including uploaded files), and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL instance, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), the `storage` GCS FUSE volume, and runs the `db-init` → `schema-load` init chain |
| 2 — Access & verify | Manual | Service answers; administrator created through the first-run form; schema confirmed in Cloud SQL |
| 3 — Operate | Manual | Inspect revisions, scale, update the dated version tag, manage secrets/storage/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database-auth, schema-load, first-run, stale-image and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
