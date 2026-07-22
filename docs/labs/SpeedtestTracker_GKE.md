---
title: "Speedtest Tracker on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Speedtest Tracker on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Speedtest Tracker on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Speedtest Tracker is an open-source, self-hosted internet speed test monitoring
tool that runs automated speed tests on a schedule and charts the results over
time. This lab takes you through the full operational lifecycle of the
**Speedtest Tracker on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Speedtest Tracker product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale (correctly, given the cron scheduler),
  update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the
  "looks healthy but the schedule never fires" failure mode.
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

1. Click **Deploy** in the RAD platform top navigation, open **Speedtest Tracker
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SpeedtestTracker_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster (a single
   always-running replica), provisions a Cloud SQL (MySQL 8.0) database with its
   Secret Manager secrets (`APP_KEY` and the database password), and runs a
   one-shot database-initialisation job. First deploys take roughly **15–25
   minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep speedtesttracker | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Speedtest Tracker exposes an unauthenticated
   health endpoint:

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/healthcheck"   # expect a 200 JSON message
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit Speedtest Tracker's
   setup wizard walks you through creating the initial administrator account — no
   pre-seeded admin credential exists in Secret Manager. After the admin account is
   created, review **Settings → General** and confirm the speed test schedule
   (`SPEEDTEST_SCHEDULE`) matches what you expect; trigger an on-demand test from
   the dashboard to confirm end-to-end connectivity works before relying on the
   schedule.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale carefully — this app is NOT a typical scale-out candidate.** Speedtest
   Tracker's in-process Laravel scheduler has no cross-pod coordination, so
   `max_instance_count` must stay at `1` while `speedtest_schedule` is set (a
   plan-time validation enforces this). Do not raise `max_instance_count` unless
   you disable the schedule and use this deployment purely as a multi-replica
   dashboard.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image is pulled and a rolling
   update replaces the pod.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~speedtesttracker"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=speedtesttracker --project="$PROJECT"
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
   memory utilisation and restart counts. The module can provision an **uptime
   check** (when enabled); review Monitoring → Uptime checks.

3. **Confirm the schedule is actually firing** — check the dashboard's results
   history for new entries appearing at the expected cadence. A pod that is
   `Ready` (`1/1 Running`, 0 restarts) is not, on its own, proof the schedule is
   producing results — the results history is the definitive signal.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Speedtest Tracker releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **"Healthy but no new results ever appear":** unlike the Cloud Run variant (where
  this points at CPU throttling), on GKE this usually means the schedule itself is
  misconfigured, or the deployment was scaled to more than 1 replica without
  disabling the schedule (duplicate/racing runs can produce inconsistent-looking
  history). Use `kubectl exec` to get a shell and inspect the running process:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- ps aux
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep SPEEDTEST_SCHEDULE
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, and Secret Manager secrets. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload (single replica), Cloud SQL (MySQL 8.0), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the initial admin account in the UI; trigger a test test |
| 3 — Operate | Manual | Inspect workload, scale carefully (max=1), update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; confirm the schedule is actually producing new results |
| 5 — Troubleshoot | Manual | Diagnose pod, "healthy but no results," database, init-job, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
