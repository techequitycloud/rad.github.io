---
title: "Roundcube on Cloud Run — Lab Guide"
description: "Hands-on lab: deploy Roundcube on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Roundcube on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Roundcube is an open-source, browser-based IMAP webmail client: users read,
search and send mail in the browser against an IMAP and SMTP server that already
exists. It is a mail **client** — this module deploys no mail server. This lab
takes you through the full operational lifecycle of the **Roundcube on Cloud
Run** module on Google Cloud: deploy it, access and verify it, connect it to a
mail server, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Roundcube product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and its login form.
- Point Roundcube at an existing IMAP and SMTP server and sign in.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the mail-server, scaling and version inputs in Tasks 3 and 4 — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.
- **An existing mail account** for Task 3: the IMAP host and port, the SMTP
  submission host and port (587 or 465 — never 25), and a username and password
  on that server.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Solutions → Solution Catalog → RAD modules**, then open **Roundcube (Cloud Run)** from the **Platform Modules** list, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0) database
   with its Secret Manager secrets (the `des_key` and the database password), a
   generic Cloud Storage bucket, builds the custom container image (wrapping
   `roundcube/roundcubemail:1.6.19-apache`), and runs the one-shot `db-init` job
   that creates the database and user. Roundcube creates its own schema when the
   container first starts. Cloud SQL creation and the image build dominate the
   first deploy.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~roundcube" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Roundcube serves its login form at the root
   path:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. The Roundcube login form appears. **You
   cannot sign in yet** — Roundcube has no local or administrator accounts and
   authenticates every user against an IMAP server, and the module deploys with
   no IMAP server configured. Task 3 connects one.

3. Confirm the schema was created in Cloud SQL by reading the container log for
   the start-up sequence, including the PHP memory line the wrapper entrypoint
   prints:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -i -E "memory_limit|error"
   ```

   Expect `[startup] PHP memory_limit set to 512M via /usr/local/etc/php/conf.d/zz-rad-overrides.ini`.

---

## Task 3 — Connect a mail server and sign in [Manual]

1. On the deployment's page, tick **Enable advanced mode**, click **Update**, and
   add these keys to `environment_variables` (Group 6), using your own servers:

   | Key | Example value |
   |---|---|
   | `ROUNDCUBEMAIL_DEFAULT_HOST` | `ssl://imap.example.com` (implicit TLS) or `tls://imap.example.com` (STARTTLS) |
   | `ROUNDCUBEMAIL_DEFAULT_PORT` | `993` (implicit TLS) or `143` (STARTTLS) |
   | `ROUNDCUBEMAIL_SMTP_SERVER` | `smtp.example.com` |
   | `ROUNDCUBEMAIL_SMTP_PORT` | `587` or `465` — **never `25`**, which Google Cloud blocks |

   These override the module's empty defaults. This wrapper has no dedicated
   IMAP/SMTP inputs, so `environment_variables` is the place to set them.

2. Apply the update and wait for the new revision. Confirm the values landed:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format=yaml | grep -A1 -E "ROUNDCUBEMAIL_(DEFAULT_HOST|DEFAULT_PORT|SMTP_SERVER|SMTP_PORT)"
   ```

3. Reload `$SERVICE_URL`, sign in with the username and password of your
   existing mail account, open the inbox, and send a test message to yourself.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Every instance reads the same `des_key` from
   Secret Manager, so a user's session stays valid whichever instance serves it.

3. **Update the application version** by changing `application_version` to
   another exact `-apache` tag and applying it via **Update**; a new image builds
   `FROM roundcube/roundcubemail:<version>` and a new revision rolls out. The
   image's `bin/installto.sh -y` upgrades the schema on start — no manual
   migration step is needed. Do not use `latest` or a rolling tag: a rebuild under
   an unchanged tag produces no new revision.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~roundcube"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^roundcube" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (scaling behaviour), and CPU /
   memory utilisation. The uptime check is **off** by default; enable it with
   `uptime_check_config` if you want one, then confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Roundcube releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. Both
  probes are HTTP `GET /`; the startup probe allows a 30 s delay plus 20 × 15 s
  attempts, because the image runs `installto.sh` and waits for the database
  before Apache starts.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login form loads but nobody can sign in:** the IMAP server is not
  configured or not reachable. Check `ROUNDCUBEMAIL_DEFAULT_HOST` and
  `ROUNDCUBEMAIL_DEFAULT_PORT` on the service (Task 3), that the scheme
  (`ssl://` / `tls://`) matches the port, and that the IMAP server accepts
  connections from the internet (or from the VPC, if you set
  `vpc_egress_setting = ALL_TRAFFIC`).
- **Mail cannot be sent:** check `ROUNDCUBEMAIL_SMTP_SERVER` and
  `ROUNDCUBEMAIL_SMTP_PORT`. Port 25 never works on Google Cloud; use 587 or 465
  on a relay that accepts authenticated mail.
- **Users are logged out at random:** the container started without
  `ROUNDCUBEMAIL_DES_KEY`. The wrapper entrypoint prints
  `WARNING: ROUNDCUBEMAIL_DES_KEY is not set` in that case — confirm the
  `des-key` secret exists and is attached to the service.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the Cloud Run service, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud
SQL, registry) are managed separately and are not removed here. Mail on your IMAP
server is untouched — Roundcube never held it.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), the `des_key` and DB secrets, a storage bucket, and runs `db-init` |
| 2 — Access & verify | Manual | Health check returns 200 with the login form; PHP memory line confirmed in the log |
| 3 — Connect a mail server | Manual | IMAP/SMTP set through `environment_variables`; sign in and send a test message |
| 4 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 6 — Troubleshoot | Manual | Diagnose revision, mail-server, session, database, init-job, and build issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
