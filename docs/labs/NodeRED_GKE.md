---
title: "NodeRED on GKE Autopilot \u2014 Lab Guide"
---

# NodeRED on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Node-RED is an open-source flow-based programming tool for wiring together IoT devices,
APIs, and online services through a visual browser-based editor. This lab takes you
through the full operational lifecycle of the **Node-RED on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Node-RED product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_GKE) — this
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
  cluster, Filestore NFS, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **NodeRED (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Filestore NFS share mounted at `/data` for persistent flow storage, a Cloud Storage
   bucket, a Secret Manager secret for the flow credential encryption key, and mirrors
   or builds the container image. No database is provisioned. First deploys take
   roughly **10–20 minutes** (Filestore provisioning dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep nodered | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. Node-RED listens on
   port 1880; the module exposes it through a LoadBalancer Service:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"
   # expect: 200
   ```

2. Open the Node-RED editor in your browser at `http://${EXTERNAL_IP}`. No credentials
   are required by default; for production deployments, IAP is recommended (see the
   Configuration Guide). The editor exposes full flow editing and credential management
   — do not leave it publicly accessible in production.

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
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1` unless flows are stateless or Redis-backed external context
   storage is enabled; session affinity (`ClientIP`) is required for the editor
   WebSocket connections.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image is mirrored or built and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~nodered"
   kubectl get jobs,cronjobs -n "$NS"          # any custom scheduled jobs
   ```

5. **Inspect the NFS-backed storage** — all flows, credentials, and installed palette
   nodes are persisted in the Filestore share mounted at `/data`:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl exec -n "$NS" \
     deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls /data
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
   **uptime check** against `/` (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Node-RED releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets HTTP GET `/` with a 30-second initial delay; NFS mount adds to startup time.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **NFS mount failure:** confirm the Filestore instance is `READY` and that the
  `nfsserver` network tag (required for NFS firewall rules) is present on the node pool.
  Verify `enable_nfs = true` and `nfs_mount_path = "/data"` are set correctly.
- **Flow credentials unreadable after an **Update**:** the `NODE_RED_CREDENTIAL_SECRET`
  may have been rotated or changed. Retrieve the current secret value and verify it
  matches the key used when flows were last deployed.
  ```bash
  CRED_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~nodered" --format="value(name)" --limit=1)
  gcloud secrets versions access latest --secret="$CRED_SECRET" --project="$PROJECT"
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and
namespace, Filestore NFS instance, Secret Manager secrets, GCS bucket, static IP, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Filestore NFS, GCS bucket, and credential secret |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes (HTTP 200 from `/`); editor loads in browser |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, inspect NFS |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, NFS mount, credential, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
