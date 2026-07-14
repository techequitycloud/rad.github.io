---
title: "EspoCRM on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy EspoCRM on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# EspoCRM on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

EspoCRM is an open-source, GPLv3-licensed Customer Relationship Management platform
built on PHP and Apache. This lab takes you through the full operational lifecycle of
the **EspoCRM on Cloud Run** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on EspoCRM product features (contacts, leads, opportunities, workflows). For the
complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the CRM, retrieve the auto-generated admin credential, and verify the
  service is healthy and connected to its database.
- Perform day-2 operations — inspect, scale, update, and manage secrets, NFS storage,
  and the database.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore NFS, Artifact Registry, and shared service accounts this module depends
  on).
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

1. In the RAD platform, open **EspoCRM (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager secrets (`ESPOCRM_ADMIN_PASSWORD` and the database
   password), a `espocrm-data` Cloud Storage bucket (provisioned but not mounted by
   default), a shared Filestore NFS volume mounted at `/var/lib/espocrm` for uploads
   (`enable_nfs = true` by default), builds the container image, and runs a one-shot
   database-initialisation job. The upstream EspoCRM installer then runs its own
   install/migrate step automatically on first container boot. First deploys take
   roughly **20–35 minutes** (Cloud SQL and Filestore creation dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~espocrm" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is serving its login page (EspoCRM's liveness endpoint is the
   unauthenticated login screen at `/`, `200` once the install/migrate step has
   finished — allow several minutes on first boot):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Retrieve the auto-generated administrator password from Secret Manager — EspoCRM's
   installer creates the `admin` user with this password on first boot, there is no
   separate account-creation step:

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-espocrm-admin-password" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in as `admin` with the retrieved
   password. Change the password immediately under **Administration → Users** — the
   auto-generated value only seeds the **first** install; losing it later requires a
   database-level reset.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). `max_instance_count` defaults to `1`: Cloud Run has no
   built-in session affinity, so verify EspoCRM's behaviour under concurrent PHP
   sessions across replicas before scaling beyond one instance.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out.

4. **Manage secrets and NFS storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~espocrm"
   gcloud filestore instances list --project="$PROJECT"   # backs /var/lib/espocrm uploads
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=espocrm --project="$PROJECT"
   ```

6. **Enable Redis (optional)** to offload EspoCRM's object cache from MySQL: set
   `enable_redis = true` and apply via **Update**; leave `redis_host` empty to reuse
   the NFS server's IP as the Redis endpoint.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The container prints its resolved
   `ESPOCRM_DATABASE_*` and `ESPOCRM_SITE_URL` values at startup, a quick way to
   confirm the DB host and site URL in use:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
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
platform-level diagnostics and do not change with EspoCRM releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe is TCP on port `80`; the liveness probe
  is `HTTP GET /` with a 300-second initial delay to allow the install/migrate step
  to finish on first boot.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, and
  that the `db-init` job completed — EspoCRM connects over private-IP TCP (not a
  socket) by default, so VPC egress must reach the instance's private IP.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Uploads missing after a restart:** confirm `enable_nfs = true` and the Filestore
  instance is healthy — without NFS, attachments live on ephemeral container disk and
  are lost when an instance is recycled.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `db_name`/`db_user` after first deploy and the
one-time-only nature of the auto-generated admin password).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This
removes everything the module created — the Cloud Run service, Cloud SQL database,
Secret Manager secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, the Filestore NFS instance, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), secrets, storage bucket + NFS mount, and runs DB init |
| 2 — Access & verify | Manual | Login page returns 200; retrieve the auto-generated admin password and log in |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/NFS, DB access, optional Redis |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, NFS, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
