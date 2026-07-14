---
title: "Ntfy on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Ntfy on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Ntfy on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_GKE)**

## Overview

**Estimated time:** 45–90 minutes

ntfy is an open-source pub/sub push-notification server: applications publish
messages over a simple REST/HTTP API and clients receive them instantly over
WebSocket or Server-Sent-Events streams, with no external database required. This
lab takes you through the full operational lifecycle of the **ntfy on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on ntfy product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including a
  publish/subscribe smoke test.
- Perform day-2 operations — inspect, scale considerations, update, and manage
  secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Ntfy (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs. Note that `Ntfy_GKE` appends `-gke` to
   `tenant_deployment_id` internally, so it can coexist with `Ntfy_CloudRun` on the
   same tenant without a naming collision.

2. The platform deploys a single Deployment workload into the GKE Autopilot
   cluster running the ntfy Go binary, and builds the container image. No database,
   cache, or object-storage bucket is provisioned — ntfy keeps its message cache in
   a local SQLite file. There is no database-initialisation job to wait for, so a
   first deploy is typically much faster than a database-backed module (roughly
   **10–15 minutes**, dominated by the image build and workload scheduling).

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep ntfy | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. ntfy's health endpoint responds as soon as the
   server binds its port — there is no database dependency to wait on:

   ```bash
   curl -s "http://${EXTERNAL_IP}/v1/health"   # expect {"healthy":true}
   ```

3. Run a publish/subscribe smoke test against the external IP:

   ```bash
   curl -d "hello from ntfy" "http://${EXTERNAL_IP}/mytopic"     # publish
   curl -s "http://${EXTERNAL_IP}/mytopic/json"                   # subscribe (streaming JSON; Ctrl-C to stop)
   ```

   Open `http://${EXTERNAL_IP}/mytopic` in a browser to see the built-in web UI
   receive the message in real time.

4. ntfy ships with **open access** — any client can publish to or subscribe from
   any topic on the public IP. There is no admin account to create. If you need
   access control, configure users and per-topic ACLs post-deploy via ntfy's CLI
   (`ntfy user add`, `ntfy access`) or by setting `NTFY_AUTH_*` environment
   variables in `environment_variables` and applying via **Update**. If you plan to
   use attachments or browser web-push, also set `NTFY_BASE_URL` to the external
   URL.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Do not scale beyond one replica.** `max_instance_count` defaults to `1` and
   should stay there — a subscriber's WebSocket/SSE stream is anchored to the pod
   holding it, and ntfy has no shared message bus. Scaling out silently splits
   subscribers across pods, so a message published against one pod is never
   delivered to a subscriber pinned to another. If you do scale, set
   `session_affinity = "ClientIP"` to keep a reconnecting subscriber pinned to the
   pod holding its cached messages. Any change to min/max instances is made via the
   RAD platform's deployment details page and applied via **Update**, not a manual
   `kubectl scale` (which would be reverted on the next apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pod. Pin an explicit `v2.x.y` in production rather than relying on
   `latest`.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~ntfy"
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

   ntfy generates no secrets of its own at deploy time — the Secret Manager list is
   only populated if you supplied entries via `secret_environment_variables`.

5. **Enable durable message history**, if the default ephemeral cache is not
   acceptable. Two options: set `enable_nfs = true` and point `NTFY_CACHE_FILE`'s
   directory at the NFS mount, or switch to a per-pod block PVC with
   `stateful_pvc_enabled = true` and `stateful_pvc_mount_path = "/var/cache/ntfy"`.
   Without one of these, the SQLite cache is lost on every pod restart.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   ntfy logs its listen address and resolved cache path on startup — check here
   first if you expected NFS/PVC persistence but the cache still looks ephemeral.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ntfy releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes both target `/v1/health`, which should return `200` within
  seconds of boot — ntfy has no database to wait on, so a slow or failing probe
  usually points at a container build or config issue rather than a downstream
  dependency.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Messages "disappear" or subscribers don't see history:** check
  `max_instance_count` (should be `1`) and whether `enable_nfs` or
  `stateful_pvc_enabled` is set — with the default stateless Deployment and
  ephemeral cache, a pod restart wipes message history by design, which is easy to
  mistake for a delivery bug. If a PVC is enabled, confirm
  `stateful_pvc_mount_path` matches `NTFY_CACHE_FILE`'s directory exactly:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl exec -n "$NS" <pod> -- ls -l /var/cache/ntfy
  ```
- **Attachments or web-push links are broken:** confirm `NTFY_BASE_URL` is set to
  the workload's external URL in `environment_variables`.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP:
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Publish/subscribe blocked unexpectedly:** check whether `enable_iap` was
  turned on — IAP requires Google sign-in and blocks unauthenticated
  publish/subscribe calls, which is usually not what a notification endpoint
  wants.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including keeping `max_instance_count = 1` and
matching the PVC mount path to the cache directory).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, any PVC, and Artifact Registry images. There is no Cloud SQL
database, GCS bucket, or auto-generated secret to clean up (ntfy provisions none by
default). Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single GKE workload running ntfy; no database or storage bucket |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; publish/subscribe smoke test confirms real-time delivery |
| 3 — Operate | Manual | Inspect workload, keep max instances at 1, update version, manage secrets/storage, enable NFS/PVC for durability |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, cache-persistence, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
