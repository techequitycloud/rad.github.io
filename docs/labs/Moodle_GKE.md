---
title: "Moodle on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Moodle on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Moodle on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Moodle is an open-source Learning Management System (LMS) used by universities,
schools, and online training providers worldwide. This lab takes you through the full
operational lifecycle of the **Moodle on GKE Autopilot** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Moodle product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets, cron, and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, Redis, Artifact Registry, and shared service
  accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Moodle (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Moodle_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets, a Filestore
   NFS share for `moodledata`, optional Redis, builds the container image, runs
   the `db-init` and `nfs-init` one-shot jobs, and provisions a Cloud Scheduler
   cron job. First deploys take roughly **25–45 minutes** (Cloud SQL and Filestore
   creation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep moodle | head -1 | cut -d/ -f2)
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
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/health.php"
   # expect 200
   ```

   > On first boot, Moodle installs its database schema before the readiness probe
   > passes. If the pod is not yet Ready, monitor startup with
   > `kubectl logs -n "$NS" -l app=moodle -f`.

2. Retrieve the database password from Secret Manager and note the Moodle cron
   and SMTP password secrets that were auto-generated:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~moodle"
   ```

   The database password secret name is reported in the deployment outputs. To
   read it:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~moodle" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Open `http://${EXTERNAL_IP}` in a browser and sign in to the Moodle admin panel.
   The initial admin credentials are set during the `db-init` job (username and
   email are configurable via `environment_variables` at deploy time).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and (if enabled) the horizontal
   autoscaler and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, Cloud Scheduler cron, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~moodle"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
     --filter="name~moodle"
   kubectl get jobs -n "$NS"
   ```

   To manually trigger the Moodle cron job:

   ```bash
   CRON_JOB=$(gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
     --filter="name~moodle" --format="value(name)" --limit=1)
   gcloud scheduler jobs run "$CRON_JOB" --location="$REGION" --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=moodle --database=moodle --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module also provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Moodle releases.

- **Pod not Ready / CrashLoopBackOff:** the readiness probe targets `/health.php`;
  Moodle allows up to 10 minutes for first-boot schema creation. Inspect events
  and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the `db-init` job
  completed successfully.
- **Initialisation jobs failed (`db-init` or `nfs-init`):** inspect the jobs and
  their pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Moodle cron not running:** confirm the Cloud Scheduler job is enabled and its
  last run succeeded; check the cron password secret exists in the namespace.
  ```bash
  gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" \
    --filter="name~moodle"
  ```
- **NFS / `moodledata` errors:** confirm the Filestore instance is `READY`; the
  `nfs-init` job must have completed to set correct `www-data` ownership. Check
  the pod's NFS mount with
  `kubectl exec -n "$NS" <pod> -- df -h | grep nfs`.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Filestore NFS share, Cloud Scheduler cron job,
Secret Manager secrets, GCS buckets, and Artifact Registry images. Resources owned
by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), Filestore NFS, Redis, Cloud Scheduler cron, secrets, and runs db-init + nfs-init jobs |
| 2 — Access & verify | Manual | Connect to the cluster; health check at `/health.php` passes; sign in to the Moodle admin panel |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/cron/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, NFS, cron, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
