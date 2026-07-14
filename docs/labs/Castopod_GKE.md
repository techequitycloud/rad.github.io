---
title: "Castopod on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Castopod on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Castopod on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Castopod is an open-source, ActivityPub-native podcast hosting platform built on
CodeIgniter 4 (PHP 8) and served by FrankenPHP/Caddy. This lab takes you through the
full operational lifecycle of the **Castopod on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Castopod product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running Castopod workload.
- Complete Castopod's web install wizard and publish a test episode.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Castopod (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Castopod_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys the FrankenPHP/Caddy workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (MySQL 8.0) database with its Secret Manager secrets
   (database password plus the auto-generated `CP_ANALYTICS_SALT`), two Cloud Storage
   buckets (`data` and `media`), an NFS (Filestore) share for durable episode audio
   and artwork, builds the custom container image (a thin build on the upstream
   `castopod/castopod` image that grafts the platform entrypoint), and runs a
   one-shot database-initialisation job. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep castopod | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Castopod's unauthenticated homepage `/` returns
   HTTP 200 once the app has booted and connected to MySQL — CodeIgniter runs its
   schema migrations automatically on first start (there is no separate migration
   job), so allow a few minutes on a fresh deploy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

   By default `enable_custom_domain = true` with `application_domains` left empty, so
   App_GKE also provisions a Gateway and a zero-config `<ip>.nip.io` HTTPS hostname
   with a Google-managed certificate — check for it if you prefer to browse over
   HTTPS:

   ```bash
   kubectl get gateway,httproute -n "$NS"
   ```

3. Open `http://${EXTERNAL_IP}` (or the nip.io HTTPS URL) in a browser and complete
   Castopod's **web install wizard** — create the first super-admin account and set
   the instance name and podcast defaults. The base URL is derived automatically from
   the foundation-injected service URL, so feed and media links point at the right
   host. The database password (in Secret Manager) can be retrieved if needed:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   gcloud secrets versions access latest --secret=<db-password-secret-name> --project="$PROJECT"
   ```

4. Upload a short test episode (audio + artwork) and confirm the public RSS feed
   renders. Uploaded media persists to the NFS-backed directory
   (`/var/lib/castopod`), shared across pods, so it survives pod restarts.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and persistent volume claims:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Castopod defaults to a single replica
   (`min_instance_count = max_instance_count = 1`); do not scale beyond 1 without
   verifying that the shared NFS media directory and the filesystem-based object
   cache (`CP_CACHE_HANDLER = file`) behave correctly across multiple pods. The
   workload is NFS-backed, so updates roll out with the `Recreate` strategy (the old
   pod terminates before the new one starts) rather than a rolling update.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and the pod is
   recreated. CodeIgniter applies any pending schema migrations automatically on the
   new container's first start.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   kubectl get jobs -n "$NS"                                         # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~castopod"
   gcloud filestore instances list --project="$PROJECT"              # NFS for media
   ```

   Keep `CP_ANALYTICS_SALT` stable — it anonymises podcast listener analytics, and
   changing it after first boot breaks de-duplication continuity for previously
   recorded analytics (it does not corrupt existing rows).

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=castopod --project="$PROJECT"
   ```

6. **Optional: enable Redis object cache.** Castopod defaults to a filesystem cache.
   To switch to Redis, set `enable_redis = true` (leave `redis_host` empty to use the
   NFS server VM's IP, which requires `enable_nfs = true`) and apply via **Update**:

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- env | grep -i redis
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
   memory utilisation, restart counts, and request metrics. Feed fetches from
   podcast apps show up as steady background request traffic. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Castopod releases.

- **Pod not Ready / CrashLoopBackOff:** the startup probe is **TCP** on the container
  port with a 30-second initial delay and a 20-retry window (`period_seconds = 15`),
  giving first-boot CodeIgniter migrations ample time to complete; the liveness probe
  is **HTTP `GET /`** with a 300-second initial delay. Inspect events and logs before
  concluding the workload failed:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL (MySQL 8.0) instance is
  `RUNNABLE` and the `db-init` job completed. Castopod reaches the database through
  the Cloud SQL Auth Proxy sidecar on `127.0.0.1:3306`; because CodeIgniter reads its
  connection from dot-notated `database.default.*` keys that cannot be expressed as
  Kubernetes env vars, the platform entrypoint writes them into Castopod's `.env`
  file at container start — inspect it directly if connectivity looks wrong:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- cat /var/www/castopod/.env
  ```
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Uploads vanish after a pod restart:** verify `enable_nfs = true` and the
  Filestore instance is healthy — with NFS off, episode audio and artwork live on
  ephemeral disk and are lost on every restart or redeploy.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Rollout appears stuck on update:** this is expected NFS-safe behaviour, not a
  failure — the Deployment uses the `Recreate` strategy, so the old pod fully
  terminates before the new one starts (a rolling update would run two pods against
  the same NFS-backed media directory and deadlock).
- **Image build/pull errors:** review Cloud Build history for the failed build's log,
  and confirm the image exists in Artifact Registry and the node service account can
  pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rules never to change `application_database_name`/
`application_database_user` or `CP_ANALYTICS_SALT` after first boot, and to keep
`database_type` at its `MYSQL_8_0` default since Castopod does not support other
engines).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This
removes everything the module created — the Kubernetes workload and namespace, Cloud
SQL database (podcasts, episodes, users, analytics), Secret Manager secrets
(including `CP_ANALYTICS_SALT`), the `data`/`media` GCS buckets, the NFS share
holding uploaded audio and artwork, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), NFS, storage buckets, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; homepage returns 200; complete the install wizard; upload a test episode and check the feed |
| 3 — Operate | Manual | Inspect workload, scale (single replica by default), update version, manage secrets/storage/Redis, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, NFS-media, rollout, and image issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
