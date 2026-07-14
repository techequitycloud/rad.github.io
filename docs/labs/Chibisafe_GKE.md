---
title: "Chibisafe on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Chibisafe on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Chibisafe on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Chibisafe is a self-hosted file and image uploader with drag-and-drop uploads,
albums, and a public API. This module deploys the **chibisafe-server backend
only** (port 8000) as a single custom-built workload on **GKE Autopilot**, by
default a StatefulSet backed by a 20Gi block PersistentVolumeClaim mounted at
`/data` — a better fit than GCS Fuse for a single-writer SQLite application.
This lab takes you through the full operational lifecycle of the **Chibisafe
on GKE Autopilot** module: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Chibisafe product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Recognise and work around a known health-probe default-path issue on first
  access.
- Perform day-2 operations — inspect the StatefulSet, manage the optional
  admin secret, and understand the storage/scaling constraints.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this
  module depends on).
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

1. In the RAD platform, open **Chibisafe (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds and pushes the custom chibisafe-server image (pinned to
   `v6.5.5` unless you set a specific version), and deploys it into the GKE
   Autopilot cluster. Because `stateful_pvc_enabled = true` by default, the
   workload type auto-resolves to a **StatefulSet** with a 20Gi
   `standard-rwo` block PVC mounted at `/data`. A `storage` Cloud Storage
   bucket is always provisioned too, but is left **unmounted** while the PVC
   default is active (it only mounts at `/data` if you disable the PVC). If
   `enable_api_key = true`, an admin-password secret is also created in Secret
   Manager and delivered as a native Kubernetes Secret. `enable_custom_domain
   = true` by default, so a Kubernetes Gateway is provisioned even before you
   set a domain. No Cloud SQL instance is created — `database_type` is fixed
   to `NONE`. First deploys typically take **10–20 minutes** (the custom image
   build dominates; there is no Cloud SQL instance to provision).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chibisafe | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running. Note this is a **StatefulSet**, not a
   Deployment:

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   ```

2. **Known issue — health probe default path.** `Chibisafe_GKE`'s
   `health_check_config` and `startup_probe_config` variables (Group 10) both
   default to path **`/`** — but the chibisafe-server backend serves all
   routes under an `/api` prefix and has **no root route** (`GET /` returns a
   non-200/404). The CloudRun variant of this module already corrects this
   (it defaults to `/api/health`), but that fix has **not** been propagated to
   `Chibisafe_GKE`'s variable defaults — this is a confirmed, currently
   unfixed latent bug. Left at the default, the pod's startup/liveness probes
   never succeed, so the pod sits in a perpetual not-Ready / crash-restart
   state even though the chibisafe-server process inside it is actually
   running fine. Check for the symptom:

   ```bash
   kubectl describe pod -n "$NS" <pod-name>
   # Events will show: Readiness probe failed / Liveness probe failed:
   # HTTP probe failed with statuscode: 404 (or similar non-200)
   ```

   **Workaround:** override both `health_check_config.path` and
   `startup_probe_config.path` to `/api/health` in the RAD platform's Group 10
   inputs, then apply via **Update** to roll a new pod with the corrected
   probe:

   ```bash
   # After overriding health_check_config / startup_probe_config to /api/health and updating:
   kubectl get pods -n "$NS"   # confirm the pod reaches Ready
   ```

3. Once the pod is `Ready`, find the workload's external address. With the
   default `enable_custom_domain = true` (Gateway) you need `application_domains`
   populated for the managed certificate to attach; alternatively switch
   `service_type` to `LoadBalancer` for a direct external IP:

   ```bash
   kubectl get svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

4. Verify the corrected health endpoint directly (from within the cluster or
   once externally reachable):

   ```bash
   kubectl exec -n "$NS" <pod-name> -- wget -qO- http://localhost:8000/api/health
   # or, once externally reachable:
   curl -s "http://${EXTERNAL_IP}/api/health"   # expect HTTP 200, {"status":"yes"}
   ```

5. This module deploys the **backend API only** — Chibisafe's separate
   SvelteKit front-end and Caddy reverse proxy are not part of this module.
   Administer the instance through the backend's REST API, or point a
   separately hosted Chibisafe front-end at the workload's address. By default
   (`enable_api_key = false`) the backend seeds its first-run administrator
   account with Chibisafe's well-known upstream default credential; redeploy
   with `enable_api_key = true` to have the module generate and inject a
   random `ADMIN_PASSWORD` instead.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count = max_instance_count
   = 1` by default and this is a hard requirement: Chibisafe is a
   single-writer SQLite application, and even though each StatefulSet replica
   gets its own PVC, scaling risks split writers and inconsistent state.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying it via **Update**; the image is
   rebuilt with the pinned `CHIBISAFE_VERSION` build arg and the StatefulSet
   pod is replaced.

4. **Manage the optional admin secret and inspect stored state** — SQLite,
   uploads, and logs live directly on the pod's PVC (there is no database
   client to connect with):

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe"
   kubectl exec -n "$NS" <pod-name> -- ls -la /data/database /data/uploads /data/logs
   kubectl exec -n "$NS" <pod-name> -- df -h /data
   ```

5. **Note the unmounted storage bucket.** A `storage` Cloud Storage bucket is
   always provisioned alongside the PVC, but stays unmounted while
   `stateful_pvc_enabled = true` (the default) — this is expected, not an
   error:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~chibisafe"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer (note the StatefulSet
   naming, unlike a Deployment):

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts (watch for the health-probe issue
   above manifesting as repeated restarts), and PVC disk usage. Keep an eye on
   the regional `SSD_TOTAL_GB` quota if you are running other stateful modules
   alongside Chibisafe — `standard-rwo` is SSD-backed by default. An uptime
   check is available but **disabled by default**
   (`uptime_check_config.enabled = false`).

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Chibisafe releases.

- **Pod stuck not-Ready / crash-restart loop (KNOWN ISSUE):** if
  `kubectl describe pod` shows startup/liveness probe failures against path
  `/`, this is the confirmed `Chibisafe_GKE` default-path bug described in
  Task 2 — the backend has no root route. Override `health_check_config.path`
  and `startup_probe_config.path` to `/api/health` and re-apply; do **not**
  assume the container itself is broken.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe failures
  kubectl logs -n "$NS" <pod> --previous       # confirm the process actually started
  ```
- **PVC stuck `Pending` / `Quota 'SSD_TOTAL_GB' exceeded`:** the default
  `standard-rwo` StorageClass is SSD-backed and draws a tight regional quota.
  Override `stateful_pvc_storage_class = "standard"` (HDD) — Chibisafe's
  SQLite/media write pattern does not need SSD IOPS. Reclaiming quota requires
  deleting the PVC/namespace; scaling to zero does not release it.
- **Gateway / managed certificate never attaches:** confirm
  `application_domains` is populated — `enable_custom_domain = true` is on by
  default but the Gateway has no hostname to bind a certificate to until you
  set one.
- **Data appears to reset after a redeploy:** confirm `stateful_pvc_enabled`
  is still `true` and `stateful_pvc_mount_path` is still `/data` — the
  entrypoint's relocation symlinks are hard-coded to that path.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the health-probe default-path issue above,
the SSD quota trade-off, and the inert `enable_redis` / `container_port`
variables).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the StatefulSet workload
and namespace, its PVC, the Cloud Storage bucket, and the optional
admin-password secret. There is no Cloud SQL database to remove — none was
ever created. Resources owned by **Services_GCP** (the VPC, GKE cluster,
Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and deploys a StatefulSet with a 20Gi block PVC at `/data`, an unmounted GCS bucket, and an optional admin secret — no Cloud SQL |
| 2 — Access & verify | Manual | Connect to the cluster; work around the known `/` health-probe default-path bug (override to `/api/health`); confirm the pod reaches Ready |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, update version, manage the admin secret, inspect SQLite/uploads/logs on the PVC; never scale past 1 replica |
| 4 — Observe | Manual | Query Cloud Logging; review pod/PVC metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose the probe-path bug, PVC/SSD quota, Gateway/certificate, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the StatefulSet, PVC, bucket, and optional secret |
