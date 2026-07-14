---
title: "Synapse on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Synapse on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Synapse on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Synapse is the reference [Matrix](https://matrix.org/) homeserver — the open-source
server for Matrix, an open standard for decentralized, federated real-time
communication. This lab takes you through the full operational lifecycle of the
**Synapse on Cloud Run** module on Google Cloud: deploy it, access and verify it,
register an admin and log in via the Matrix API, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Matrix product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running homeserver, and register an admin user.
- Log in over the Matrix client API and connect the Element web client.
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
- A **domain you control** for `server_name` if you intend to federate (set it before
  the first deploy — it is immutable).

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Synapse (Cloud Run)**, set `project_id`, and — importantly
   — set **`server_name`** to your real domain (it is baked into every user ID and is
   immutable after first boot). Review the rest of the inputs; the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager secrets (the registration shared secret and the database
   password), a Cloud Storage data bucket and NFS volume for the signing key and media,
   builds the container image, and runs a one-shot `db-init` job that creates the
   database **with the mandatory `C` collation**. There is no separate migrate job —
   Synapse builds its own schema on first start. First deploys take roughly **20–35
   minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the commands
   keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~synapse" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify; register an admin [Manual]

1. Confirm the homeserver is healthy. Synapse serves an unauthenticated `200 OK` at
   `/health`, and the Matrix client API advertises its supported spec versions:

   ```bash
   curl -s "$SERVICE_URL/health"                     # expect: OK
   curl -s "$SERVICE_URL/_matrix/client/versions"    # expect JSON: {"versions":["r0.0.1",...]}
   ```

2. **Register the first admin user.** Open self-service registration is disabled by
   default; you create users out-of-band with `register_new_matrix_user`, which is
   authorised by the registration shared secret stored in Secret Manager. Read the
   secret, then register interactively against the running service:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~synapse AND name~secret-key" --format="value(name)" --limit=1)
   SHARED_SECRET=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")

   register_new_matrix_user \
     -u admin -p '<choose-a-strong-password>' -a \
     -k "$SHARED_SECRET" \
     "$SERVICE_URL"
   ```

   `-a` grants admin; `-k` passes the shared secret so no `homeserver.yaml` path is
   needed from your workstation.

3. **Log in over the Matrix API** to confirm the account works end to end:

   ```bash
   curl -s -XPOST "$SERVICE_URL/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

4. **Connect a client.** Open the [Element](https://app.element.io/) web app, choose
   *Sign in* → *Edit* the homeserver, and enter `$SERVICE_URL` (or your custom domain).
   Sign in as `admin`. You now have a working Matrix homeserver.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Keep it warm.** Synapse defaults to `min_instance_count = 1` with
   `cpu_always_allocated = true` so the homeserver keeps handling federation and
   background tasks between requests. Do **not** scale it to zero if you federate — a
   cold instance misses inbound federation traffic. Scaling is a configuration change
   via **Update**, not a manual `gcloud` edit (a manual edit is reverted on the next
   apply).

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.
   Synapse applies any schema upgrades itself on start.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance — and confirm the
   collation:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=synapse --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory utilisation.
   The module also provisions an **uptime check** against `/health`; confirm it is green
   under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Synapse releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs
  for startup errors. The probe targets `/health` on port 8008; a probe pointed at an
  authenticated Matrix path would 401/403 and never pass.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`Database has incorrect values for … collation`:** the database was not created with
  `C` collation. Confirm the `db-init` job ran; re-run it or recreate the (empty)
  database with `LC_COLLATE='C' LC_CTYPE='C'`.
- **Federation broken / device sessions lost after a redeploy:** the signing key was
  regenerated because the data directory was not persistent. Ensure `enable_nfs = true`
  (the default) so `/data` survives restarts — the signing key must never change.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret exists, and the `db-init` job completed successfully.
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rules that `server_name` and the signing key are
immutable after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record
is retained for history). If a deployment is stuck and the RAD platform can no longer
manage it (for example after manual changes that conflict with the Terraform state), use
**Purge** instead — it removes the deployment from RAD's records **without** destroying
the cloud resources (it makes RAD forget the project). This removes everything the module
created — the Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS buckets,
NFS volume, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15, C collation), secrets, storage, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; register an admin with `register_new_matrix_user`; log in via the Matrix API; connect Element |
| 3 — Operate | Manual | Inspect revisions, keep warm, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, collation, signing-key, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
