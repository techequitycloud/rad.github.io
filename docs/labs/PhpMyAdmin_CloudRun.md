---
title: "PhpMyAdmin on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy PhpMyAdmin on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PhpMyAdmin on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

phpMyAdmin is the most popular open-source web tool for administering MySQL and
MariaDB databases over the browser — browse and edit tables, run SQL, manage users,
and import/export data. This lab takes you through the full operational lifecycle of
the **phpMyAdmin on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

Unlike most modules in this repository, phpMyAdmin does not own or provision a
database — it is a *client* that connects to a MySQL/MariaDB server that already
exists elsewhere (the platform's shared Cloud SQL instance, another Cloud SQL
instance, or any reachable host). "Deploying" phpMyAdmin means standing up the web UI
and its connectivity path to that external server, not creating new data storage.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on phpMyAdmin product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and confirm which MySQL/MariaDB server it
  targets.
- Perform day-2 operations — inspect, scale, update the version, and pin or widen the
  MySQL target.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, and shared service accounts this module depends on — and, if you
  want phpMyAdmin to administer it, the platform's shared MySQL instance).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- Access to (or credentials for) a **MySQL/MariaDB server** you intend to administer —
  phpMyAdmin creates no database of its own.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **PhpMyAdmin (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun)
   documents every input by group, with defaults. Decide up front whether you want
   `pma_arbitrary = "1"` (default — users type any MySQL host at login) or a fixed
   `pma_host` with `pma_arbitrary = "0"` (single pinned server, e.g. the platform's
   Cloud SQL private IP). Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds the thin custom container image (`FROM phpmyadmin/phpmyadmin`),
   mirrors it into Artifact Registry, and provisions the Cloud Run service. There is
   **no Cloud SQL instance, no Secret Manager secret, and no database-initialisation
   job** — phpMyAdmin provisions no data store of its own. First deploys typically take
   only **5–10 minutes** (an image build and a Cloud Run rollout — none of the
   Cloud SQL provisioning time other application modules incur).

3. When it completes, discover the service with a name-agnostic filter (so the command
   keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~phpmyadmin" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. phpMyAdmin serves its login page at `/` with a `200`
   as soon as Apache/PHP is ready — there is no database-connectivity dependency to
   wait on, since phpMyAdmin holds no database of its own:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Confirm which MySQL/MariaDB server phpMyAdmin is configured to target by
   inspecting the injected `PMA_*` env vars on the running revision:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'
   ```

3. Open `$SERVICE_URL` in a browser.
   - If `PMA_ARBITRARY = "1"` (default), the login page shows a server-input box —
     type the MySQL/MariaDB host, then your username and password for that server.
   - If a fixed `pma_host` is set (`PMA_ARBITRARY = "0"`), only username and password
     are shown, scoped to that one server.
   In both cases, **authenticate with the target MySQL server's own account** —
   phpMyAdmin has no admin account of its own to create, and stores nothing between
   requests beyond the session cookie.

4. To administer the platform's shared Cloud SQL MySQL instance, first find its
   private IP:

   ```bash
   gcloud sql instances list --project="$PROJECT" --filter="databaseVersion~MYSQL"
   gcloud sql instances describe <instance-name> --project="$PROJECT" \
     --format='value(ipAddresses[0].ipAddress)'
   ```

   Enter that IP as the server (arbitrary mode) or confirm it matches the configured
   `pma_host` (pinned mode). Reaching a private-IP MySQL server requires the service's
   VPC egress to route private ranges (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`,
   the default).

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted on
   the next apply). phpMyAdmin scales to zero by default (`min_instance_count = 0`,
   forced by the module) since it is a stateless, interactive admin console with no
   background work.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Because phpMyAdmin holds no schema and no cryptographic keys, redeploys
   and version bumps carry none of the migration/key-rotation risk other stateful
   modules have.

4. **Re-point or widen the MySQL target** by changing `pma_host` / `pma_arbitrary` /
   `pma_port` in the RAD platform and applying **Update** — no data migration is
   involved since phpMyAdmin owns no data.

5. **Manage ingress and access control** — because phpMyAdmin grants full database
   administration to anyone who reaches it with valid MySQL credentials, review
   `ingress_settings` and consider enabling `enable_iap` (with
   `iap_authorized_users`/`iap_authorized_groups`) before leaving it running:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.metadata.annotations)'
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
   count, request latency (P50/P95/P99), instance count (scale-to-zero and cold-start
   behaviour), and CPU/memory utilisation. The module also provisions an **uptime
   check** when the service is publicly reachable; confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with phpMyAdmin releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for Apache/PHP startup errors. The startup probe targets `/` with a short
  initial delay (10s) and up to ~6 retries at a 10s period — phpMyAdmin boots in a
  few seconds, so a probe failure almost always points at the container itself, not a
  slow dependency (it has none).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login page loads but every login fails:** this is a MySQL-side credential or
  reachability problem, not a phpMyAdmin or Cloud Run issue — phpMyAdmin stores no
  credentials of its own. Confirm the target host is correct, the account exists on
  that MySQL server, and the account's host-grants (`user@host`) allow a connection
  from the Cloud Run service's egress path.
- **"Cannot connect" / timeout at login:** confirm `vpc_egress_setting` routes private
  ranges, that the target MySQL server's private IP is correct, and that its firewall
  rules or authorized networks allow the platform VPC's range.
- **Wrong or unexpected MySQL host offered at login:** re-check the injected `PMA_*`
  env vars on the running revision — a stale revision may still be serving traffic
  after an update:
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles, and
  (if `enable_iap = true`) that your identity is listed in `iap_authorized_users` or
  `iap_authorized_groups`.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including why leaving `ingress_settings = "all"` without IAP
is a **Critical**-risk misconfiguration for a database-admin tool, and why
`PMA_ARBITRARY = "1"` widens the blast radius of a compromised session).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This
removes everything the module created — the Cloud Run service and its Artifact
Registry image. Because phpMyAdmin provisions no database, no Secret Manager secrets,
and no storage bucket of its own, there is nothing else for this module to clean up —
the MySQL/MariaDB server it was pointed at is **not** touched (it is owned elsewhere,
typically by Services_GCP or another application module). Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds/mirrors the image and provisions the Cloud Run service only — no database, secrets, or storage bucket are created |
| 2 — Access & verify | Manual | Login page returns 200; confirm the configured MySQL target; authenticate with that server's own credentials |
| 3 — Operate | Manual | Inspect revisions, scale (scale-to-zero by default), update version, re-point the MySQL target, review ingress/IAP |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, MySQL-connectivity, ingress/IAM, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes the Cloud Run service and image; the external MySQL server is unaffected |
