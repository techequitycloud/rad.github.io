---
title: "Wallabag on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Wallabag on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Wallabag on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Wallabag is an open-source, self-hosted "read it later" article archiving app —
save articles from a browser extension, bookmarklet, mobile app, or the REST
API, and read them later in a clean, distraction-free view with full-text search
and tagging. This lab takes you through the full operational lifecycle of the
**Wallabag on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Wallabag product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, and log in with the default administrator account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Wallabag (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallabag_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   a Cloud SQL (MySQL 8.0) database with its Secret Manager secrets (`APP_SECRET`
   and the database password), a generic Cloud Storage bucket, builds the custom
   container image, and runs the two-stage initialization chain: `db-init`
   (creates the database/user/grants) followed by `wallabag-install` (Wallabag's
   own installer, which creates the schema and seeds the default administrator
   account in one step). First deploys take roughly **15–25 minutes** (Cloud SQL
   creation and the image build dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep wallabag | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Wallabag redirects an unauthenticated request
   to the root path to its login page — expect **HTTP 302**, not 200:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 302
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Log in with Wallabag's documented
   default administrator credentials — **username `wallabag`, password
   `wallabag`** — seeded by the `wallabag-install` init job. **Change this
   password immediately** (top-right menu → your account → change password).
   Self-service sign-up is disabled by default, so this is the only account
   until you create more from the admin UI.

4. Save a test article to confirm end-to-end write/read against the real
   database: paste any article URL into the "Save a new entry" box and confirm
   it appears in your list with its title and content fetched. This is the
   surest sign the app is actually writing to Cloud SQL and not to a throwaway
   local file (see the Troubleshoot section for why that distinction matters).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — Deployment, pods, and events:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). Keep `max_instance_count = 1` unless you
   have verified Wallabag's shared-session behaviour under multiple pods.

3. **Update the application version** by changing `application_version` in the
   RAD platform and applying it via **Update**; a new image builds `FROM
   wallabag/wallabag:<version>` and the pod is recreated. `wallabag-install`
   re-runs safely against the existing schema (it is idempotent) — no manual
   migration step is needed.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~wallabag"
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallabag"
   kubectl get jobs -n "$NS"          # db-init and wallabag-install jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=wallabag --project="$PROJECT"
   ```

6. **Set up the browser extension / mobile app / API access.** With the admin
   account logged in, go to your account settings to view your API client
   credentials, or generate a new API client under Developer → My applications.
   Use `http://${EXTERNAL_IP}` (or your custom domain, if configured) as the
   server address when configuring the official Firefox/Chrome extension or a
   mobile client.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics, plus the Cloud SQL
   instance dashboard. The module can provision an **uptime check**; if
   enabled, review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Wallabag releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is TCP on port 80 (only needs nginx to bind); a 302 from the liveness
  probe's `GET /` is expected and healthy — a connection failure to Cloud SQL
  (via the Auth Proxy sidecar on `127.0.0.1:3306`) is what actually keeps the
  pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep SYMFONY__ENV__DATABASE
  ```
- **Articles vanish after a pod restart — the #1 thing to check on this
  module.** This is the signature symptom of Wallabag silently installing
  against a local SQLite file instead of MySQL: the pod boots, the health
  checks pass, articles save and appear to work, but everything disappears on
  the next pod restart or rescheduling. This happens if
  `SYMFONY__ENV__DATABASE_DRIVER` is ever unset or overridden — it must
  explicitly be `pdo_mysql` (the shipped `entrypoint.sh` sets this; do not add
  a conflicting `SYMFONY__ENV__DATABASE_DRIVER` via `environment_variables`).
  Use `kubectl exec` to check the boot log for `"Configuring the SQLite
  database..."` versus a MySQL connection line — this is exactly the kind of
  distinction that is only visible with shell access to the pod, not from the
  outside. See the Configuration Guide's *Configuration Pitfalls* section for
  the full explanation.
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  `db-init` job completed before `wallabag-install` ran (it is safe to re-run;
  `max_retries = 3`).
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-or-wallabag-install-job-name>
  ```
- **Rollout stuck on update:** check for a stuck DB connection or Auth Proxy
  sidecar handoff from the old pod if the new pod doesn't reach Ready promptly.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.
- **Can't log in with `wallabag` / `wallabag`:** if the password was already
  changed by a previous operator, use `gcloud sql connect` (Task 3) or the
  install job's logs to confirm `wallabag-install` actually ran; a fresh
  deployment always seeds the default credentials on first successful install.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas — especially the critical
`SYMFONY__ENV__DATABASE_DRIVER` rule above.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs the `db-init` → `wallabag-install` init chain |
| 2 — Access & verify | Manual | Connect to the cluster; health check returns 302 to `/login`; log in with default `wallabag`/`wallabag`; save a test article |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access, extension/API setup |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, and init-job issues — including the silent-SQLite-fallback symptom |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
