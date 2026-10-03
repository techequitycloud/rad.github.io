---
title: "InvenTree on Cloud Run — Lab Guide"
description: "Hands-on lab: deploy InvenTree on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# InvenTree on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

InvenTree is an open-source inventory management system — parts, stock
locations, suppliers, bills of materials, and purchase and sales orders. This lab
takes you through the full operational lifecycle of the **InvenTree on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on InvenTree product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Reach the service on the URL InvenTree accepts, and verify it is healthy.
- Confirm the two-container revision (web + `qcluster` worker) and the `db-init` → `migrate` job chain.
- Perform day-2 operations — inspect, scale, update, and manage the data directory and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL, the NFS server, Artifact
  Registry, and shared service accounts this module depends on). You do not need
  to deploy this yourself first — the platform automatically detects whether it
  already exists in the target project and provisions it before this module if
  not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling, storage and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Solutions → Solution Catalog → RAD modules**, then open **InvenTree (Cloud Run)** from the **Platform Modules** list, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service (a web container plus a
   `qcluster` worker sidecar), a Cloud SQL (MySQL 8.0) database with its
   password in Secret Manager, two Cloud Storage buckets, builds the custom
   container image (wrapping `inventree/inventree`), and runs the
   initialization chain: `db-init` (database, user, grants) followed by
   `migrate` (Django migrations). First deploys take roughly **20–35 minutes**
   (Cloud SQL creation, the image build and the migrations dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix). Build the
   **project-number** URL — InvenTree rejects the hash-form URL that
   `status.url` reports (see Task 2):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~inventree" --format="value(metadata.name)" --limit=1)
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
   SERVICE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

   The same URL is the deployment's `service_url` output.

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. The root path redirects to the web UI —
   expect **HTTP 302**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
   ```

2. See why the URL matters. The hash-form URL Cloud Run also advertises does not
   match `INVENTREE_SITE_URL`, and InvenTree answers it with an error (`INVE-E7`):

   ```bash
   HASH_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   curl -s -o /dev/null -w "%{http_code}\n" "$HASH_URL/"      # expect 500
   ```

   Hand out `$SERVICE_URL` (or a custom domain) — never the hash form.

3. Confirm the revision runs two containers — the web container and the
   `qcluster` sidecar:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.spec.containers[].name)"
   ```

4. Confirm the init chain ran and the schema exists. The `migrate` job logs the
   number of tables it found (`[migrate] tables present: N`) and fails if there
   are fewer than 10:

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~inventree"
   gcloud logging read "resource.type=\"cloud_run_job\" AND textPayload:\"[migrate]\"" \
     --project="$PROJECT" --limit=10 --format="value(textPayload)"
   ```

5. Open `$SERVICE_URL` in a browser. The module creates **no** InvenTree
   account (the `admin_email` input is not used). To sign in, create the first
   superuser yourself — for example with InvenTree's own
   `INVENTREE_ADMIN_USER` / `INVENTREE_ADMIN_EMAIL` / `INVENTREE_ADMIN_PASSWORD`
   settings (see the InvenTree documentation), added through
   `environment_variables` and applied with **Update**. A credential-named key
   such as `INVENTREE_ADMIN_PASSWORD` is moved into Secret Manager automatically.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Make the data directory persistent.** By default InvenTree's data
   directory (`/home/inventree/data`: media, plugins, `config.yaml`, the
   generated secret key) is on the container's own filesystem and is lost on
   every cold start. For any deployment you intend to keep, set
   `enable_nfs = true` and `nfs_mount_path = "/home/inventree/data"` and click
   **Update**. Both are needed — NFS at the default path mounts a directory
   InvenTree never uses.

3. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Set `min_instance_count = 1` if scheduled work
   matters: while the service is scaled to zero the `qcluster` worker is not
   running either.

4. **Update the application version** by changing `application_version` to an
   exact tag in the RAD platform and applying it via **Update**; a new image
   builds `FROM inventree/inventree:<version>` and the `migrate` job applies any
   new migrations before the new revision rolls out.

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # User and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^inventree" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. Both containers log to the same
   service; the web container's startup line reads
   `[startup] InvenTree site=… db=…`:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and CPU /
   memory utilisation. The module's **uptime check** is off by default
   (`uptime_check_config.enabled = false`); enable it with **Update** if you want
   one, then confirm it is green under Monitoring → Uptime checks and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with InvenTree releases.

- **HTTP 500 with `INVE-E7` in the logs:** the request used a host other than
  `INVENTREE_SITE_URL` — almost always the hash-form `*.a.run.app` URL. Use the
  project-number URL (`service_url` output) or a custom domain.
- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors. The entrypoint refuses to start if
  `INVENTREE_SITE_URL`/`CLOUDRUN_SERVICE_URL` or any of `DB_IP`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD` is missing, and names the missing variable. A failure
  in the `qcluster` sidecar fails the whole revision too.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Everyone is logged out / uploads vanish after idle:** the data directory is
  not persistent — see Task 3, step 2.
- **`Database Migrations required` or missing tables:** the `migrate` job did
  not complete. Read its execution logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
  If the schema was left half-applied, re-running `migrate` fails with
  `Duplicate column name`; the database has to be dropped and recreated.
- **UI renders unstyled:** look for `WARNING: collectstatic failed` in the web
  container's startup logs.
- **Background tasks never run:** check that `enable_background_worker` and
  `cpu_always_allocated` are both `true`, and that an instance exists
  (`min_instance_count = 1`).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the Cloud Run service, the init jobs, the Cloud SQL database, Secret Manager
secrets, Cloud Storage buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL instance, NFS server, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (web + `qcluster`), Cloud SQL (MySQL 8.0), buckets, and runs `db-init` → `migrate` |
| 2 — Access & verify | Manual | 302 on the project-number URL, 500 on the hash URL; two containers; schema present |
| 3 — Operate | Manual | Persist the data directory on NFS, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose host mismatch, startup, data-loss, migration, and worker issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
