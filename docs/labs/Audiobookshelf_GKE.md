---
title: "Audiobookshelf on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Audiobookshelf on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Audiobookshelf on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Audiobookshelf is a self-hosted audiobook and podcast server with a web UI, mobile
apps, and per-user listening-progress sync. This lab takes you through the full
operational lifecycle of the **Audiobookshelf on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Audiobookshelf product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale (within its single-writer limit),
  update, and manage the block-storage volume.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Audiobookshelf (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE)
   documents every input by group, with defaults. If you want a directly reachable
   external IP without configuring a custom domain, set `service_type = "LoadBalancer"`
   now (the default `ClusterIP` is only reachable in-cluster, though a custom domain
   is enabled by default and provides its own external path). Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the workload into the GKE Autopilot cluster as a
   **StatefulSet** with a per-pod block **Persistent Volume Claim** mounted at
   `/data`, builds a thin-wrapper container image
   (`FROM ghcr.io/advplyr/audiobookshelf`) into Artifact Registry, and reserves a
   static external IP. There is **no Cloud SQL database, no Redis, and no
   initialisation job** — Audiobookshelf self-initialises its SQLite database on
   first boot directly on the persistent volume. With no database to provision,
   first deploys take roughly **15–25 minutes** (the Cloud Build image build and
   PVC provisioning dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep audiobookshelf | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find the StatefulSet's pod and PVC:

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   SERVICE=$(kubectl get svc -n "$NS" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
   echo "Service: $SERVICE"
   ```

2. Confirm the service is healthy. Audiobookshelf's health path is `/healthcheck`,
   an unauthenticated 200 endpoint (the startup probe allows up to 10 failures at a
   10-second period after a 15-second initial delay — about 115 seconds of first-boot
   grace):

   ```bash
   kubectl exec -n "$NS" statefulset/"$SERVICE" -- wget -qO- http://localhost:80/healthcheck
   # or, without exec:
   kubectl port-forward -n "$NS" svc/"$SERVICE" 8080:80 &
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
   ```

3. Find the external address. If `service_type = LoadBalancer`, read the Service's
   IP; if you kept the default custom domain / static IP path, read the reserved
   address instead:

   ```bash
   kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}'
   gcloud compute addresses list --project="$PROJECT" --filter="name~audiobookshelf"
   ```

4. Open the address (or configured custom domain) in a browser. On first boot
   Audiobookshelf presents its **first-run setup wizard** — create the initial
   **root** (admin) user with a strong password. There is no generated credential to
   retrieve: this module creates **no application secrets** (no database password,
   no master key). API tokens for the mobile apps or automation are minted later in
   the web UI.

5. Immediate hardening: because the admin account is created by whoever reaches the
   wizard first, complete step 4 right after deploying — or restrict reachability
   (keep `service_type = ClusterIP`, or gate the custom domain behind IAP) until you
   have.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS" "$SERVICE"
   ```

2. **Scale — do not.** `min_instance_count` and `max_instance_count` are both pinned
   to `1` by design: Audiobookshelf serves one shared SQLite library from one
   single-writer block volume, and a second pod writing the same PVC risks database
   and media-index corruption. Raising `max_instance_count` via **Update** is the
   only way this changes, and it is **not supported** by the application.

3. **Update the application version** by changing the `application_version` input
   via **Update** on the deployment details page; Cloud Build produces a new image
   (using the app-specific `AUDIOBOOKSHELF_VERSION` build ARG) and the StatefulSet's
   `OrderedReady` rolling update replaces the single pod. Note `latest` resolves to a
   pinned version (`2.17.0` at the time of writing) — pin an explicit tag to control
   upgrades deliberately.

4. **Manage the persistent volume and jobs:**

   ```bash
   kubectl get pvc -n "$NS"
   kubectl describe pvc -n "$NS" -l app="$SERVICE"
   gcloud compute disks list --project="$PROJECT" --filter="name~audiobookshelf"
   kubectl get jobs -n "$NS"          # none by default; only present if you added custom jobs
   gcloud secrets list --project="$PROJECT" --filter="name~audiobookshelf"   # expect none — no app secrets
   ```

5. **Back up the state** on demand by copying off the mounted volume (the module
   also supports a scheduled backup via `backup_schedule`):

   ```bash
   kubectl exec -n "$NS" statefulset/"$SERVICE" -- tar czf - -C /data . \
     > "audiobookshelf-data-$(date +%F).tar.gz"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$SERVICE" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (library scans are the spikes to watch), restart counts, and
   PVC usage. The module can provision an **uptime check** (disabled by default,
   path `/healthcheck`) when the endpoint is publicly reachable — review Monitoring
   → Uptime checks and Alerting → Policies after enabling it.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Audiobookshelf releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/healthcheck`; a mount problem with the PVC or a corrupted SQLite file
  will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck `Pending` with a PVC-related event:** check for storage-class or
  regional SSD quota exhaustion — GKE block PVCs default to the SSD-backed
  `standard-rwo` StorageClass, which draws the (often tight) `SSD_TOTAL_GB` quota,
  and scaling a stateful app to zero does **not** release its PVC.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # look for "Quota 'SSD_TOTAL_GB' exceeded"
  kubectl get pvc -n "$NS"
  ```
  If you hit this, redeploy (or update, where supported) with
  `-var stateful_pvc_storage_class=standard` (HDD `pd-standard`) — Audiobookshelf's
  SQLite/media workload does not need SSD IOPS. Reclaiming already-consumed SSD
  quota requires deleting the PVC, not just scaling to zero.
- **No external reachability:** the default `service_type` is `ClusterIP`
  (in-cluster only). Confirm the Service type and, if using the custom-domain path,
  that the Gateway/managed certificate has provisioned:
  ```bash
  kubectl get svc,gateway -n "$NS"
  kubectl describe managedcertificate -n "$NS"
  ```
- **Database or media-index corruption:** almost always caused by more than one
  writer against `/data`. Confirm `max_instance_count = 1` and that no manual
  `kubectl scale` was applied (a manual scale is reverted on the next apply, but
  can cause damage in the interim).
- **Image pull errors:** confirm the image exists in Artifact Registry (Cloud Build
  wraps `ghcr.io/advplyr/audiobookshelf` into your registry) and the node service
  account can pull it:
  ```bash
  gcloud builds list --project="$PROJECT" --limit=5
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project="$PROJECT"
  ```

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the SSD-quota StorageClass choice and why
`max_instance_count` must stay at `1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the block Persistent Volume Claim (and its underlying Persistent
Disk — the SQLite database and all library metadata), the reserved static IP, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single-pod StatefulSet with a block PVC at `/data`, builds the image, and reserves a static IP — no database, no secrets |
| 2 — Access & verify | Manual | Connect to the cluster; `/healthcheck` returns 200; create the root user in the first-run wizard |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep replicas at 1 (single-writer SQLite), update version, back up `/data` |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/SSD-quota, ingress, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC/disk |
