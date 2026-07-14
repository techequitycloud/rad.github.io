---
title: "Budibase on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Budibase on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Budibase on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Budibase is an open-source low-code platform for building internal tools,
business apps, and workflows on top of your data. The official image is an
**all-in-one** container that bundles CouchDB, MinIO, and Redis alongside the
Budibase apps/worker/proxy, so this module needs no external managed database —
on GKE, all of that state persists to a block Persistent Disk. This lab takes
you through the full operational lifecycle of the **Budibase on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Budibase product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, find the workload's namespace, and access the
  running service.
- Perform day-2 operations — inspect the StatefulSet and PVC, understand why
  scaling is fixed at a single replica, update the version, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **Budibase (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform builds a thin pass-through wrapper image (`FROM budibase/budibase`)
   and mirrors it into Artifact Registry, then deploys a single-replica
   **StatefulSet** into the GKE Autopilot cluster (`stateful_pvc_enabled = true`
   auto-resolves `workload_type` to `StatefulSet`) with a 20Gi block Persistent
   Disk mounted at `/data`, a Cloud Storage data bucket, an external
   LoadBalancer Service, and seven internal-credential secrets in Secret Manager
   (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
   `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). There is **no
   Cloud SQL instance** and no database-initialisation job — Budibase
   self-provisions its bundled CouchDB and MinIO on first boot onto the PVC.
   First deploys take roughly **15–25 minutes**.

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep budibase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and find its external address:

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. The startup and liveness probes target the unauthenticated root `/`, which
   returns `200` once the bundled CouchDB, MinIO, Redis, and app tier are all up.
   Allow up to roughly **8–9 minutes** on first boot (a 60-second initial delay
   plus a 30-retry window at a 15-second period):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Budibase self-hosted ships with
   **no default admin account** — the setup screen prompts you to create the
   initial administrator (email + password). Do this immediately after deploy;
   until an admin is claimed, anyone who reaches the URL can claim the instance.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, PVC, and events:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe pod -n "$NS" -l app="$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')"
   ```

2. **Confirm the `/data` mount is backed by the PVC**, since this is what makes
   GKE the durable Budibase platform:

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- df -h /data
   ```

3. **Do not change scaling.** `min_instance_count = max_instance_count = 1` is a
   hard requirement, not a starting point — the all-in-one pod holds all state
   on its single PVC, so a second replica would not share the data store
   (split-brain). Leave these two inputs untouched, and never force
   `workload_type = "Deployment"` (it fails at plan time alongside
   `stateful_pvc_enabled = true`, since a Deployment cannot template per-pod PVCs).

4. **Update the application version** by changing `application_version` in the
   RAD platform and applying it via **Update**; this rebuilds the thin wrapper
   image (pinned through the `BUDIBASE_VERSION` build ARG) and replaces the pod.
   The PVC and its data survive the update.

5. **Manage secrets, storage, and jobs** — list them, but never rotate any of
   the seven auto-generated secrets after first boot; the data on the PVC is
   keyed with these exact values and becomes unreadable if any of them changes:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~budibase"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC disk usage (it grows with app
   data and attachments — size `stateful_pvc_size` generously). If an
   **uptime check** is enabled, review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Budibase releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `/`; a pod that has not finished starting CouchDB, MinIO, Redis,
  and the app tier will keep failing the probe until the full first-boot window
  elapses.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Memory pressure / OOM at startup:** the bundled CouchDB + MinIO + Redis + app
  tier need generous memory; running below roughly 2Gi risks OOM kills during
  first boot. Confirm `container_resources` memory against the Configuration
  Guide's recommended sizing.
- **PVC not bound / pod stuck Pending:** check `kubectl describe pod` events for
  scheduling or quota issues, and confirm the PVC has a bound status:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **No external IP:** confirm the LoadBalancer Service has an assigned IP; this
  can take a few minutes after the Service is created:
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **No admin / unclaimed instance:** if you did not create the administrator
  account immediately after first access, anyone reaching the external IP can
  still claim it — check whether an unexpected admin account already exists.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate any of
the seven auto-generated internal credentials after first boot, and why
`stateful_pvc_enabled` must stay `true`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the block PVC and its data, Secret Manager secrets, GCS bucket,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a thin wrapper image and deploys a single-replica StatefulSet with a 20Gi PVC on `/data`, a GCS bucket, a LoadBalancer Service, and seven internal-credential secrets — no Cloud SQL |
| 2 — Access & verify | Manual | Connect to the cluster; HTTP `/` returns 200; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep scaling fixed at 1/1, update version, manage secrets (never rotate) |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics, PVC disk usage, and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and its persisted data |
