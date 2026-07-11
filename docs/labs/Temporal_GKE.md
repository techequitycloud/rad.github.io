---
title: "Temporal on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Temporal on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Temporal on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Temporal is an open-source durable workflow orchestration engine that provides
reliable execution with automatic retries, timers, signals, and queries — backed by
PostgreSQL for persistent workflow history storage. This lab takes you through the
full operational lifecycle of the **Temporal on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Temporal product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and verify the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL for PostgreSQL, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **Temporal (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions two
   Cloud SQL (PostgreSQL) databases (primary persistence and visibility) with their
   Secret Manager secret, builds the container image, and starts the Temporal
   all-in-one server (which handles schema initialisation automatically on first
   start). First deploys take roughly **10–20 minutes** (Autopilot node provisioning
   and schema initialisation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep temporal | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and the gRPC Frontend port is reachable:

   ```bash
   kubectl get pods,svc -n "$NS"
   ```

   All pods should be in `Running` state. Temporal exposes its Frontend service on
   port **7233** (gRPC). Health probes are TCP-based — there is no HTTP health
   endpoint. Confirm the pod has passed its startup probe by checking that it is
   `Ready`:

   ```bash
   kubectl get pods -n "$NS" -o wide
   ```

2. If the optional Web UI companion service was enabled, port-forward to it and
   open `http://localhost:8080` in your browser:

   ```bash
   WEB_SVC=$(kubectl get svc -n "$NS" -o name | grep -i web | head -1 | cut -d/ -f2)
   kubectl port-forward svc/"$WEB_SVC" 8080:8080 -n "$NS"
   ```

3. Verify the Temporal cluster is healthy from inside the admin-tools pod (if
   deployed as a companion service):

   ```bash
   ADMIN_POD=$(kubectl get pods -n "$NS" -o name | grep admintools | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$ADMIN_POD" -- temporal operator cluster health
   ```

   Expected result: `SERVING`.

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

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods. Review the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Temporal_GKE) for
   schema migration behaviour before upgrading.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~temporal"
   kubectl get jobs -n "$NS"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~temporal-temporal-db-password" --format="value(name)" --limit=1 \
     | sed 's/.*secret-//;s/-temporal-db-password//')
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
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
   utilisation, restart counts, and scheduling metrics. The module also provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Temporal releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Startup probe timeout:** Temporal uses a TCP probe on port 7233. If the pod
  keeps restarting during first deploy, schema initialisation may still be in progress
  — the startup probe allows up to 5 minutes. Check logs for `"msg":"Completed schema
  setup"` to confirm whether initialisation finished.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret was injected into the pod, and the PostgreSQL private IP is
  reachable from the cluster:
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud secrets list --project="$PROJECT" --filter="name~temporal"
  ```
- **Schema initialisation failed:** the `temporalio/auto-setup` image logs all schema
  steps to stdout — review pod logs for errors related to `temporal-sql-tool` or
  PostgreSQL connectivity.
- **Pending pod / no service IP:** check `kubectl describe pod` events for resource
  or quota issues on Autopilot, and confirm the Service has the expected type:
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `num_history_shards`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL databases and user, Secret Manager secret, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
Cloud SQL instance, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL databases, secret, and runs schema init |
| 2 — Access & verify | Manual | Connect to the cluster; pod is Ready; gRPC Frontend on port 7233 is reachable |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, startup probe, database, schema-init, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
