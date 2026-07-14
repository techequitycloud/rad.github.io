---
title: "Matomo on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Matomo on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Matomo on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Matomo is the leading open-source web analytics platform — a privacy-focused,
self-hosted alternative to Google Analytics with no data sampling and 100%
ownership of the collected data. This lab takes you through the full operational
lifecycle of the **Matomo on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Matomo product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and complete Matomo's first-run web installer.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, and shared service accounts this module
  depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Matomo (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Matomo_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (MySQL 8.0) database with its Secret Manager password secret, a
   Filestore NFS share that persists Matomo's document root (`/var/www/html`), a
   dedicated `data` GCS bucket, mirrors the official `matomo:5-apache` image into
   Artifact Registry (no Cloud Build step — this is a **prebuilt** module), and runs
   a one-shot `db-init` job that creates the empty database and user. First deploys
   take roughly **20–35 minutes** (Cloud SQL and Filestore creation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep matomo | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Matomo's health path is `/`, which returns HTTP
   200 — or **302 to the installer on a fresh deploy** — once Apache and PHP are
   running. The startup probe allows a generous window (TCP on `/`, 30s initial
   delay, 15s period, 20 failure threshold) for the image entrypoint to populate
   the empty NFS-mounted document root from `/usr/src/matomo` on first boot:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On a fresh deploy Matomo presents its
   **web installer**: the database connection screen is pre-filled from the
   injected `MATOMO_DATABASE_HOST`/`USERNAME`/`DBNAME`/`PASSWORD` environment
   variables (the `db-init` job already created the empty database and user, and
   the platform maps the deployment-scoped Cloud SQL credentials onto these
   Matomo-native names — the same "override the generic DB env vars to match the
   app's own convention" pattern used elsewhere in this platform, e.g. SnipeIT's
   Laravel-style mapping). Click through the installer, create the **superuser**
   account, and register your first tracked website. The installer writes
   `config.ini.php` to the NFS-persisted document root, so setup survives pod
   restarts. If you ever need the database password:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~matomo" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

4. **Immediate hardening:** the installer URL is public until setup completes —
   finish the wizard right after deploying. Then copy the tracking snippet from
   **Administration → Websites → Tracking Code** into a test page and confirm the
   visit appears under **Visitors → Visits Log**.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods (Matomo deploys as a
   `Deployment` using the `Recreate` update strategy, since the workload is
   NFS-backed and a rolling update would run two pods against the same shared
   volume and database):

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Both
   default to **1**, and `max_instance_count` should stay at **1** unless
   multi-pod NFS/session/archive-lock behaviour has been explicitly verified —
   Matomo does not natively coordinate tracking-log writes or archive processing
   across replicas sharing one NFS volume and one database. `session_affinity =
   ClientIP` keeps a client's requests on the same pod.

3. **Update the application version** by changing the `application_version` input
   (use an **Apache variant** tag, e.g. `5.11-apache`, `latest`) and applying it via
   **Update**; the mirrored image updates and a `Recreate` rollout replaces the pod.
   Matomo runs its own schema migrations from the persistent document root — there
   is no headless migration job.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~matomo"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~-data"
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance (analytics tables use
   the fixed `matomo_` prefix):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=matomo --project="$PROJECT"
   ```

6. **Archive processing (app-specific).** This module does not provision a CronJob
   for Matomo's periodic archive processing (`console core:archive`) — reports
   default to browser-triggered archiving inside visitor requests. For busier
   sites, add a scheduled job via the generic `cron_jobs` input (Group 11)
   pointing at the deployed image and the archive command.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics, plus Cloud SQL metrics
   for the MySQL instance. The module can provision an **uptime check** (when
   enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Matomo releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  is TCP on `/` with a 20-failure threshold to cover the first-boot copy of the
  application into the empty NFS volume; the liveness probe is HTTP `GET /` with a
  300s initial delay (a 200 or 302-to-installer response counts as healthy).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** Matomo reaches Cloud SQL through the **Cloud SQL
  Auth Proxy sidecar on `127.0.0.1:3306`** (`enable_cloudsql_volume = true` is
  required on GKE). Confirm the MySQL 8.0 instance is `RUNNABLE`, the DB password
  secret materialised into the namespace, and the `db-init` job completed — it
  verifies the app user's credentials, so a green `db-init` rules out most auth
  issues.
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep MATOMO_DATABASE
  ```
- **`db-init` job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Installer reappears after every restart / config not persisted:** verify
  `enable_nfs = true` and `nfs_mount_path = /var/www/html`, and confirm the PVC is
  bound:
  ```bash
  kubectl get pvc -n "$NS"
  ```
  If the document root is not actually persisted, `config.ini.php` is lost on
  every pod recreation and Matomo re-enters setup.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP (`reserve_static_ip = true` keeps it stable across redeploys).
- **Image pull errors:** this is a **prebuilt** module — there is no Cloud Build
  step. Confirm the mirrored image exists in Artifact Registry and that
  `application_version` is a real **Apache variant** tag (`5-apache`,
  `5.11-apache`); fpm/alpine tags don't serve HTTP on port 80.
- **Rolling update wedges / two pods fighting over NFS:** confirm the Deployment's
  update strategy is `Recreate` (the module sets this automatically for
  NFS-backed workloads) — a `RollingUpdate` strategy on this workload would start
  a second pod against the same NFS volume and database before the first
  terminates.
- **Redis "enabled" but nothing changes:** `enable_redis = true` only wires
  `REDIS_HOST`/`REDIS_PORT` into the pod's environment — connectivity, not
  configuration. Nothing in this module edits Matomo's `config.ini.php`
  `[Cache]` backend, so using Redis as Matomo's object cache still requires
  manual post-deploy configuration.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `application_database_name`/
`application_database_user` after first deploy and the fixed `MYSQL_8_0` engine).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secret, GCS data bucket,
Filestore NFS share, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), Filestore NFS, GCS bucket, secret, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete Matomo's web installer and verify tracking |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access, archive-job note |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, NFS, image, rollout-strategy, and Redis issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
