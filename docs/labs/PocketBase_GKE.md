---
title: "PocketBase on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy PocketBase on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PocketBase on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_GKE)**

## Overview

**Estimated time:** 45–90 minutes

PocketBase is an open-source backend in a single file — an embedded SQLite database with a
realtime REST API, built-in authentication, file storage, and an admin dashboard. This lab
takes you through the full operational lifecycle of the **PocketBase on GKE Autopilot** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
PocketBase product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running StatefulSet.
- Access and verify the workload, and claim the first-run admin account.
- Perform day-2 operations — inspect, back up, and update the deployment.
- Understand why this module runs a single-replica StatefulSet with a block PVC.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster,
  Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **PocketBase (GKE)** from the
   **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_GKE) documents
   every input by group, with defaults. Leave `stateful_pvc_enabled = true` and
   `max_instance_count = 1` — the embedded SQLite database needs the block PVC's reliable
   file locking, and a second replica cannot mount the ReadWriteOnce volume. Review the
   estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a **StatefulSet** with
   a 20 GiB block Persistent Volume mounted at `/pb_data`, and builds the container image.
   There is **no Cloud SQL instance and no database-initialisation job** — PocketBase creates
   its own SQLite schema on first start. First deploys typically complete in **10–20
   minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep pocketbase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running. The Service is `ClusterIP` by default (internal only); if you
   enabled `service_type = LoadBalancer`, find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. PocketBase exposes a public, unauthenticated health
   endpoint that returns as soon as the binary is up — there is no external database to wait
   on:

   ```bash
   # From outside the cluster (only if a LoadBalancer/external IP is configured):
   curl -s "http://${EXTERNAL_IP}/api/health"
   # Or from inside the cluster, against the pod directly:
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- http://127.0.0.1:8090/api/health
   ```

3. Open the admin UI at `/_/` (via the external IP, or `kubectl port-forward` if the Service
   stayed `ClusterIP`) **immediately**:

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8090:8090   # if internal-only
   ```

   Whoever reaches `/_/` first is prompted to create the administrator (superuser) account —
   no admin credential is pre-seeded in Secret Manager, and until the account is claimed
   anyone who can reach `/_/` can claim it. Fill in an email and password and finish the setup
   wizard, then sign in and browse the default collections to confirm the database
   initialised correctly.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — the StatefulSet, its pod, and the bound PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and `max_instance_count` both
   default to `1` and the RAD platform enforces this deliberately — SQLite is single-writer
   and the PVC is ReadWriteOnce, so a second replica cannot even mount the volume. If you need
   more capacity, increase `cpu_limit` / `memory_limit` on the single pod rather than raising
   replica counts.

3. **Update the application version** by changing the version input in the RAD platform and
   applying it via **Update**; a new image builds and a rolling update replaces the pod.
   PocketBase applies any pending schema migrations automatically on the next start, so back
   up the PVC (step 4) before bumping the version — an interrupted upgrade can leave the
   database mid-migration.

4. **Back up `/pb_data`** — the block PVC is the entire database and file store:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /pb_data
   kubectl cp "$NS/$POD:/pb_data/data.db" ./pb_data-backup.db
   ```

5. **Manage your own secrets** (only relevant if you added SMTP or external backup
   credentials — PocketBase auto-generates none):

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~pocketbase"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and PVC usage. Replica count should stay flat at 1. The
   uptime check is disabled by default; enable `uptime_check_config` if you want alerting on
   availability, then confirm it under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with PocketBase releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and liveness
  probes target `/api/health`, which needs no external dependency, so a failure here almost
  always points to a container-level problem (bad image, missing env var, port mismatch)
  rather than a database issue.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck `Pending`:** check for PVC provisioning/quota issues — a fresh 20 GiB
  `standard-rwo` (SSD) PVC draws from the regional `SSD_TOTAL_GB` quota, which is easy to
  exhaust on a quota-constrained project:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # look for "Quota ... exceeded" or FailedScheduling
  kubectl get pvc -n "$NS"
  ```
- **Data appears missing or reset:** confirm `stateful_pvc_enabled = true` and that the pod is
  bound to the expected PVC (StatefulSet pods rebind to the same PVC by ordinal across
  restarts) — a `Deployment` workload type or a disabled PVC leaves SQLite on ephemeral pod
  storage, lost on every restart.
- **Can't reach `/_/` or someone else claimed the admin account:** there is no reset
  mechanism from the platform side; use the PocketBase CLI/API against the running pod, or
  restore from a pre-claim backup of the PVC if this happened on a fresh deploy.
- **No external IP:** confirm `service_type = LoadBalancer` is set (default is internal
  `ClusterIP`), and check `kubectl get svc -n "$NS"` for a pending `EXTERNAL-IP`.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node service
  account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including why `max_instance_count` must never be raised and why `workload_type` should be
left `null` to auto-resolve to `StatefulSet`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example
after manual changes that conflict with the Terraform state), use **Purge** instead — it
removes the deployment from RAD's records **without** destroying the cloud resources (it makes
RAD forget the project). This removes everything the module created — the Kubernetes
StatefulSet, namespace, and the block PVC (which **is** the entire SQLite database and
uploaded files — back it up first if you need to keep it). Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Artifact Registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single-replica StatefulSet with a 20Gi block PVC at `/pb_data`; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; claim the first-run admin account at `/_/` immediately |
| 3 — Operate | Manual | Inspect the StatefulSet, keep replica count at 1, back up the PVC, update version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/quota, admin-claim, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the StatefulSet, namespace, and the PVC that holds all data |
