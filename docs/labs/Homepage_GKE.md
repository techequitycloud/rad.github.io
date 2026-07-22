---
title: "Homepage on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Homepage on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Homepage on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_GKE)**

## Overview

**Estimated time:** 30–45 minutes

Homepage is a self-hosted, highly customizable application dashboard — a
single landing page of links, bookmarks, and live status/stats widgets for
your other self-hosted services, configured entirely through YAML files.
This lab takes you through the full operational lifecycle of the **Homepage
on GKE Autopilot** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Homepage's own dashboard-editing features. For the
complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Understand the two storage layouts GKE offers Homepage (GCS FUSE vs. a block PVC) and which one is deployed.
- Perform day-2 operations — inspect, scale, and update.
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

CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

export NAMESPACE=$(kubectl get ns -o name | grep homepage | head -1 | cut -d/ -f2)
echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Homepage (GKE)**, set `project_id`, and
   review the inputs. Most deployments need no changes to the defaults — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_GKE)
   documents every input by group. If your project's external-IP quota is
   constrained, set `service_type = "ClusterIP"` and `reserve_static_ip =
   false` (this is what this module's own live verification used). Review
   the estimated cost (if credits are enabled) and click **Deploy**, which
   opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster and
   provisions its storage. By default this is a stateless **Deployment**
   with a `storage` GCS bucket mounted at `/app/config` via the GCS FUSE CSI
   driver. If `stateful_pvc_enabled = true` is set, the workload is instead
   a **StatefulSet** with a per-pod block PVC (`standard-rwo`, `5Gi`
   default) at the same path. **There is no Cloud SQL instance, no Redis,
   and no Secret Manager secret** — Homepage needs none of them. First
   deploys typically complete in **5–10 minutes**, faster than most modules
   in this catalogue since there is no database to provision.

3. Confirm the workload and its pods:

   ```bash
   kubectl get all -n "$NAMESPACE"
   # If stateful_pvc_enabled = true, also check the PVC:
   kubectl get pvc -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its address. If
   `service_type = LoadBalancer`:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   SERVICE_URL="http://${EXTERNAL_IP}"
   ```

   If `service_type = ClusterIP` (e.g. under a quota-constrained project),
   use `kubectl port-forward` instead — no external IP is spent:

   ```bash
   SVC=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NAMESPACE" "svc/$SVC" 18080:3000 &
   SERVICE_URL="http://localhost:18080"
   ```

2. Confirm the service is healthy — Homepage's own unauthenticated health
   endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/healthcheck" -o /dev/null -w '%{http_code} %{size_download}\n'
   # expect: 200 <n-bytes>
   curl -s "$SERVICE_URL/api/healthcheck"
   # expect: "up"
   ```

3. Open `$SERVICE_URL` in a browser (or `curl` it directly if using
   port-forward). **There is no first-run setup wizard and no login** —
   Homepage renders its dashboard immediately from whatever config exists in
   `/app/config` (the upstream image's own bundled defaults on a fresh
   deployment). You should see Homepage's default landing page.

4. Confirm which storage mode is active and where the configuration
   actually lives:

   ```bash
   kubectl get statefulset -n "$NAMESPACE" 2>/dev/null && echo "block-PVC mode" \
     || echo "GCS FUSE mode (Deployment)"
   ```

   - **GCS FUSE mode:**
     ```bash
     BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~homepage" \
       --format="value(name)" --limit=1)
     gcloud storage ls "gs://$BUCKET/"
     gcloud storage cat "gs://$BUCKET/settings.yaml"
     ```
   - **Block-PVC mode:**
     ```bash
     POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
     kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /app/config
     kubectl exec -n "$NAMESPACE" "$POD" -- cat /app/config/settings.yaml
     ```

5. Make a real, stateful change and confirm it persists — edit
   `services.yaml` directly (via the bucket or `kubectl exec`, matching
   whichever storage mode is active), then reload the page. Homepage reads
   its YAML config live on every request, so the new entry appears
   immediately with no restart required — this is the actual proof the
   storage wiring works end-to-end.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,statefulset,pods -n "$NAMESPACE" 2>/dev/null
   kubectl describe pod -n "$NAMESPACE" $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   ```

2. **Scale** by changing the min/max instance inputs and clicking
   **Update**. In the default GCS FUSE storage mode, scaling beyond one
   replica is genuinely safe — every pod reads the same shared bucket, no
   in-process cache. **If `stateful_pvc_enabled = true`, keep
   `max_instance_count = 1`** — each StatefulSet pod ordinal gets its own
   separate PVC, so multiple replicas would each maintain an independently
   diverging config rather than a shared dashboard.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Since the image is genuinely prebuilt
   (`ghcr.io/gethomepage/homepage`), no local Cloud Build step is involved —
   the platform just points the next rollout at the new tag.

4. **Confirm there are no secrets to manage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homepage"
   # expect: no results — this is correct, not a misconfiguration
   ```

5. **Inspect or back up the configuration:**

   ```bash
   # GCS FUSE mode:
   gcloud storage rsync "gs://$BUCKET/" /tmp/homepage-config-backup/
   # Block-PVC mode:
   kubectl cp "$NAMESPACE/$POD:/app/config" /tmp/homepage-config-backup/
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}') --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts, and request metrics. The module
   can provision an **uptime check** (disabled by default); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The
  startup and liveness probes both target `/api/healthcheck`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous        # logs from the crashed container
  ```

- **`EACCES`/permission errors writing to `/app/config` (block-PVC mode
  only).** The entrypoint's own chown step normally handles this at boot
  with no configuration needed. If you still see a permission error, check
  `stateful_fs_group` (default `3000`) and confirm it wasn't overridden to
  something inconsistent with the container's runtime user.

- **Widgets fail to load data / `/api/*` calls 400.** This is almost always
  `HOMEPAGE_ALLOWED_HOSTS` rejecting the request's `Host` header. The default
  is `*` (accepts any host), so this should only happen if it was tightened
  and the deployed hostname changed since. Verify the injected value:
  ```bash
  kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].spec.template.spec.containers[0].env}' \
    | grep -o '"name":"HOMEPAGE_ALLOWED_HOSTS"[^}]*'
  ```

- **Configuration edits don't appear.** Confirm you edited the file actually
  mounted at `/app/config` — the correct target (GCS bucket vs. `kubectl
  exec` into the pod's PVC) depends on which storage mode is active (see
  Task 2, step 4) — and that the browser tab was reloaded. Homepage has no
  server-side cache to invalidate, so a stale view is almost always a stale
  browser tab or the wrong storage target, not a wiring problem.

- **Scaling beyond 1 replica in block-PVC mode "loses" config changes on
  some requests.** This is expected, not a bug — each StatefulSet pod
  ordinal has its own independent PVC. Set `max_instance_count = 1`, or
  switch to the default GCS FUSE mode if you need multiple replicas.

- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (or switch to `ClusterIP` + `kubectl port-forward` if your
  project's static-IP quota is exhausted).

- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it, use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources.
This removes everything the module created — the Kubernetes workload and
namespace, the `storage` GCS bucket (or the block PVC, in block-PVC mode)
and every YAML config file in it, and any Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload and its storage (GCS FUSE bucket by default, or a block PVC with `stateful_pvc_enabled = true`) — no database, no Redis, no secrets |
| 2 — Access & verify | Manual | Connect to the cluster or port-forward; `/api/healthcheck` returns `200 "up"`; dashboard renders with no setup wizard; a direct config edit proves the storage wiring |
| 3 — Operate | Manual | Inspect the workload, scale (only safe beyond 1 replica in GCS FUSE mode), update version, back up the configuration |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod health, `HOMEPAGE_ALLOWED_HOSTS`, storage-target confusion, and scaling-with-PVC issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the configuration storage |
