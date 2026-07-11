---
title: "Vaultwarden on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Vaultwarden on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Vaultwarden on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Vaultwarden is a lightweight, self-hosted Bitwarden-compatible password manager written
in Rust. This lab takes you through the full operational lifecycle of the
**Vaultwarden on GKE Autopilot** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Vaultwarden product features or Bitwarden client setup. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

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

1. Click **Deploy** in the RAD platform top navigation, open **Vaultwarden (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

   > **Note:** `signups_allowed` defaults to `false`. Set it to `true` only if you
   > need to register the first account immediately after deploy, then apply an **Update** providing
   > `false` to close registrations.

2. The platform deploys a StatefulSet with a 10 Gi PersistentVolumeClaim into the GKE
   Autopilot cluster, provisions a Cloud SQL (PostgreSQL) database with its Secret
   Manager secrets, a Cloud Storage attachments bucket, builds the container image, and
   runs a one-shot database-initialisation job. First deploys take roughly **20–35
   minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep vaultwarden | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}/alive"   # expect: OK
   ```

2. The Vaultwarden web vault is accessible at `http://${EXTERNAL_IP}` in a browser.
   There is no auto-generated admin credential stored in Secret Manager — the `/admin`
   panel is disabled by default and is only activated when `ADMIN_TOKEN` is supplied in
   `environment_variables` at deploy time.

3. Retrieve the database password from Secret Manager (for reference or DBA access):

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~vaultwarden" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, horizontal autoscaler, and persistent
   volumes:

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods while the PVC
   retains all vault data.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~vaultwarden"
   kubectl get jobs -n "$NS"          # DB-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=vaultwarden --project="$PROJECT"
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
   utilisation, restart counts, and PVC usage. The module can provision an **uptime
   check** targeting `/alive`; review Monitoring → Uptime checks and
   Alerting → Policies when enabled.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Vaultwarden releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs; the startup and
  liveness probes both target `/alive`:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret materialised into the namespace, and the init job completed. Also
  confirm `enable_cloudsql_volume = true` — Vaultwarden requires the Cloud SQL Auth
  Proxy sidecar via Unix socket.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **PVC not bound / pod stuck Pending:** check `kubectl describe pvc -n "$NS"` events
  for StorageClass or capacity issues.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (notably `signups_allowed`, `container_port`, `enable_cloudsql_volume`, and
`quota_memory_requests` binary-unit requirement).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and
namespace, PersistentVolumeClaim, Cloud SQL database, Secret Manager secrets, Cloud
Storage buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet, PVC, Cloud SQL, GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes at `/alive`; web vault is reachable |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, PVC, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
