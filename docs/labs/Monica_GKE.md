---
title: "Monica on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Monica on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Monica on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Monica is an open-source personal relationship management (PRM) application — a
"personal CRM" for organising how you stay in touch with friends, family, and
contacts. This lab takes you through the full operational lifecycle of the
**Monica on GKE Autopilot** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Monica product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **Monica (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Monica_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (MySQL 8.0) database with its Secret Manager secrets (the Laravel
   `APP_KEY` and the database password), a Cloud Storage `monica-uploads` bucket
   plus a default `data` bucket, and an NFS volume shared across pods for Laravel's
   `storage/` directory. No image is built — the workload pulls the official
   prebuilt `monica:<version>` image — and a one-shot database-initialisation job
   runs. First deploys take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep monica | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. The startup probe is TCP on `/` (passes as soon
   as Apache binds the port); the liveness probe is HTTP `GET /`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

   Allow a generous window on first request after pod creation — Apache boot plus
   the entrypoint's `php artisan migrate --force` both run before the page serves.

3. Open `http://${EXTERNAL_IP}` in a browser. Monica has **no default credentials** —
   an unauthenticated visitor is redirected to the registration/setup page.
   Register the first account (use `admin@techequity.cloud` for RAD deployments);
   it becomes the administrator. Once the external IP or a custom domain is
   settled, set `APP_URL` to that address via `environment_variables` and apply
   via **Update** so absolute links and redirects resolve correctly.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and persistent volumes:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). GKE has no scale-to-zero, so `min_instance_count`
   defaults to `1`; a single replica suits a personal CRM.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new pod template pulls the new
   `monica:<version>` tag. Because the app is NFS-backed, the rollout uses the
   `Recreate` strategy (the old pod terminates before the new one starts) to
   avoid two pods contending on the same volume/database during the switch.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~monica"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   Never rotate the `APP_KEY` secret after first boot — it is a Laravel
   encryption key, and rotating it permanently corrupts every encrypted database
   field and invalidates all sessions.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=monica --project="$PROJECT"
   ```

6. **Inspect uploaded files** (contact photos/documents live under Laravel's
   `storage/`, shared across pods via NFS by default and mirrored to the
   `monica-uploads` bucket):

   ```bash
   gcloud storage ls gs://<uploads-bucket>/
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
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Monica releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  is TCP on `/` (passes as soon as Apache binds the port); the liveness probe is
  HTTP `GET /` with a generous delay for the first-boot migration.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the `db-init` job completed. Monica reaches MySQL through the Cloud SQL Auth
  Proxy sidecar on `127.0.0.1:3306` (`enable_cloudsql_volume = true`); a different
  `DB_HOST` cannot reach the database on GKE.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Rollout wedged on an update:** because the app is NFS-backed, updates use the
  `Recreate` strategy — a rollout that still hangs is more likely a probe or
  migration failure on the new pod than a volume contention issue; check
  `kubectl describe deploy` and the new pod's logs.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the `monica:<version>` tag exists upstream and the
  node service account can pull it (this module uses the official prebuilt image,
  not a custom build).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot,
and the immutability of `application_database_name`/`application_database_user`
once set).

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
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), secrets, storage buckets, NFS, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate rollout), manage secrets/storage, DB access, inspect uploads |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, rollout, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
