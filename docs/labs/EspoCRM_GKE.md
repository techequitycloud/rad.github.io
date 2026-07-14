---
title: "EspoCRM on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy EspoCRM on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# EspoCRM on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE)**

## Overview

**Estimated time:** 45–90 minutes

EspoCRM is an open-source, GPLv3-licensed Customer Relationship Management platform
built on PHP and Apache. This lab takes you through the full operational lifecycle of
the **EspoCRM on GKE Autopilot** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
EspoCRM product features (contacts, leads, opportunities, workflows). For the complete
list of provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, discover the namespace, and access the running workload.
- Retrieve the auto-generated admin credential and verify the workload is healthy and
  connected to its database.
- Perform day-2 operations — inspect, scale, update, and manage secrets, NFS storage,
  and the database.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **EspoCRM (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/EspoCRM_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (MySQL 8.0) database with its Secret Manager secrets
   (`ESPOCRM_ADMIN_PASSWORD` and the database password), a `espocrm-data` Cloud
   Storage bucket, a shared Filestore NFS volume mounted at `/var/lib/espocrm` for
   uploads (`enable_nfs = true` by default), builds the container image, and runs a
   one-shot database-initialisation job. The pod reaches Cloud SQL through a
   co-located Auth Proxy sidecar on loopback (`enable_cloudsql_volume = true` by
   default). The upstream EspoCRM installer then runs its own install/migrate step
   automatically on first pod start. First deploys take roughly **20–35 minutes**
   (Cloud SQL and Filestore creation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep espocrm | head -1 | cut -d/ -f2)
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

2. Confirm the workload is serving its login page (EspoCRM's health endpoint is the
   unauthenticated login screen at `/`, `200` once the install/migrate step has
   finished):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

   On a slow first boot the startup (10s initial delay) and liveness (15s initial
   delay) probes are noticeably tighter than the Cloud Run variant's — pods can flap
   briefly while the install/migrate step finishes; give it a few minutes before
   troubleshooting.

3. Retrieve the auto-generated administrator password from Secret Manager — EspoCRM's
   installer creates the `admin` user with this password on first boot:

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-espocrm-admin-password" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` in a browser and log in as `admin` with the retrieved
   password. Change the password immediately under **Administration → Users** — the
   auto-generated value only seeds the **first** install; losing it later requires a
   database-level reset.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). `max_instance_count` defaults to `1`; session
   affinity (`ClientIP`) is set by default to keep a client's requests on the same
   pod once you scale beyond one replica. Because the workload is NFS-backed, the
   foundation uses the `Recreate` update strategy so two pods never write the same
   NFS volume during a rollout.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and the pods are
   recreated.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~espocrm"
   gcloud filestore instances list --project="$PROJECT"   # backs /var/lib/espocrm uploads
   kubectl get jobs -n "$NS"          # db-init job
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

1. **Logs** — from `kubectl` or the Logs Explorer. The container prints its resolved
   `ESPOCRM_DATABASE_*` and `ESPOCRM_SITE_URL` values at pod start, a quick way to
   confirm the DB host and site URL in use:

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
platform-level diagnostics and do not change with EspoCRM releases.

- **Pod not Ready / flapping on first boot:** the startup probe (10s initial delay,
  10s period, 3 failures) and liveness probe (15s initial delay, 30s period, 3
  failures) are both `HTTP GET /`. On a slow first boot (the install/migrate step),
  pods can flap before EspoCRM finishes initializing; raise the initial delay /
  failure threshold via `startup_probe_config` / `health_check_config` if this
  persists.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and the
  `db-init` job completed. The pod reaches MySQL through the Auth Proxy sidecar on
  `127.0.0.1:3306` (`enable_cloudsql_volume = true`) — do not override `DB_HOST`.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Uploads missing after a restart:** confirm `enable_nfs = true` and the Filestore
  instance is healthy — without NFS, attachments live on ephemeral pod disk and are
  lost on restart/reschedule.
- **Rollout wedged on update:** an NFS-backed EspoCRM workload uses `Recreate`, not
  `RollingUpdate` — a surge pod would otherwise deadlock on the shared NFS volume and
  the database. If you see "Waiting for rollout to finish: old replicas are pending
  termination", confirm the strategy has not been overridden.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `application_database_name`/
`application_database_user` after first deploy and the one-time-only nature of the
auto-generated admin password).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This
removes everything the module created — the Kubernetes workload and namespace, Cloud
SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, the
Filestore NFS instance, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), secrets, storage bucket + NFS mount, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; login page returns 200; retrieve the auto-generated admin password and log in |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/NFS, DB access, optional Redis |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, rollout, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
