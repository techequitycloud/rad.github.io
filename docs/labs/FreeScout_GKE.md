---
title: "FreeScout on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy FreeScout on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# FreeScout on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreeScout_GKE)**

## Overview

**Estimated time:** 45–90 minutes

FreeScout is a free, self-hosted help desk and shared-mailbox platform built on
Laravel (PHP) — it turns shared email inboxes into a collaborative ticket queue
with conversations, tags, saved replies, and a REST API. This lab takes you
through the full operational lifecycle of the **FreeScout on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on FreeScout product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreeScout_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  seeded first-run admin account.
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

1. Click **Deploy** in the RAD platform top navigation, open **FreeScout (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/FreeScout_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   a Cloud SQL for **MySQL 8.0** database with its Secret Manager secrets (the
   Laravel `APP_KEY`, the seeded `ADMIN_PASS`, and the database password), a
   Filestore NFS mount for attachments (enabled by default), a Cloud Storage
   uploads bucket, builds the thin custom container image
   (`FROM tiredofit/freescout`), and runs a one-shot database initialisation
   job. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep freescout | head -1 | cut -d/ -f2)
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

2. Confirm the service is responding. FreeScout has no dedicated JSON health
   endpoint — a healthy pod returns the login page (HTTP 200) or a redirect to
   it on `GET /`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200 (or 302 to login)
   ```

3. FreeScout seeds a first-run administrator automatically — there is no manual
   sign-up step. Retrieve the generated admin password from Secret Manager and
   sign in with the default `ADMIN_EMAIL` (`admin@techequity.cloud` unless
   overridden):

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freescout AND name~admin" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Open `http://${EXTERNAL_IP}` in a browser and log in with that email/password.
   **Change the password in the UI immediately** — the generated value only
   lives in Secret Manager and this app-side change gives you a human-owned
   credential.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and PVC/storage state:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). FreeScout defaults to
   `min_instance_count = 1` and `max_instance_count = 1` (always at least one
   pod, keeping the help-desk endpoint reachable) — keep max at 1 unless
   multi-pod behaviour on shared NFS/DB has been confirmed safe. Session
   affinity (`ClientIP`) is set by default to keep a client's requests on the
   same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Because FreeScout is NFS-backed,
   the foundation uses a `Recreate` rollout strategy — the old pod is fully
   stopped before the new one starts (avoiding two pods contending on the same
   NFS volume and database), so expect a short outage during an update rather
   than a zero-downtime rolling replacement. The `tiredofit/freescout` image
   runs `php artisan migrate --force` on every container start, so schema
   changes apply automatically on boot.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~freescout"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

   **Never rotate the `APP_KEY` secret after first boot** — it encrypts session
   data and encrypted database columns (stored mailbox credentials, OAuth
   tokens); rotating it permanently invalidates all previously encrypted data.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~freescout" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=freescout --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with FreeScout releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is TCP on the container port (30 s delay, 20 failures) and the
  liveness probe is HTTP `GET /` (300 s initial delay) — allow several minutes
  on first boot while migrations run.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Migration failures on boot:** `php artisan migrate --force` runs on every
  container start (there is no separate migration job); a failed migration
  shows up as a crash loop on the pod — read the container logs above for the
  Laravel/PDO error.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and that the Cloud SQL Auth Proxy sidecar is healthy — GKE reaches MySQL over
  the proxy's loopback address (`127.0.0.1:3306`), not the private IP directly.
  ```bash
  kubectl logs -n "$NS" <pod> -c cloud-sql-proxy
  ```
- **db-init job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Update appears "stuck":** because FreeScout uses a `Recreate` rollout
  (NFS-backed), the old pod fully terminates before the new one is scheduled —
  a brief `0/1` Ready window during an update is expected, not a hang.
- **Attachments/uploads disappearing:** confirm `enable_nfs = true` (the
  default) and check `kubectl get pvc,pv -n "$NS"` — without NFS, uploaded
  files are not shared across pods or rescheduling.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`APP_KEY` after first boot, and why `database_type` must stay `MYSQL_8_0`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), Filestore NFS, secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; log in with the seeded admin account and change the password |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate rollout), manage secrets/storage (never rotate `APP_KEY`), DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, migration, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
