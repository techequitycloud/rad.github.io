---
title: "Prowlarr on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Prowlarr on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Prowlarr on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Prowlarr is the central indexer manager for the *arr media-automation suite
(Sonarr, Radarr, Lidarr, Readarr) — instead of configuring indexers
separately in each app, operators configure them once in Prowlarr, which
syncs that configuration out to each connected app's API. This lab takes you
through the full operational lifecycle of the **Prowlarr on GKE Autopilot**
module: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

**This is the only lab for Prowlarr in this catalogue.** Prowlarr is
GKE-only — the official image's init system (s6-overlay) cannot exec inside
Cloud Run's gVisor sandbox, so there is no `Prowlarr_CloudRun` variant to
compare against. See the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
§3 for the full diagnostic writeup if you're curious why.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Prowlarr's own indexer-management features. For the
complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
— this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform (with the recommended block PVC and a reachable `LoadBalancer` Service) and locate the resources it provisions.
- Access and verify the running workload via its unauthenticated `/ping` status endpoint.
- Understand Prowlarr's no-default-login posture and enable authentication from the web UI if you want it.
- Perform day-2 operations — inspect, scale (or rather, understand why you shouldn't), and update.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including why Cloud Run is never the right target for this app.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this
  module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **kubectl** installed, with cluster credentials obtained (see below).
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Prowlarr (GKE)**, set `project_id`, and
   review the inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Prowlarr_GKE)
   documents every input by group, with defaults. **Set `service_type =
   "LoadBalancer"` explicitly** — the inherited Foundation default
   (`ClusterIP`) leaves Prowlarr's web UI unreachable from outside the
   cluster. Leave `stateful_pvc_enabled = true` (the default) for a real
   block PVC backing the embedded SQLite database. Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform provisions the Kubernetes workload (a StatefulSet with a
   `20Gi` HDD PVC mounted at `/config`), a `storage` Cloud Storage bucket
   (provisioned but unused as a mount with the default PVC layout), and the
   `LoadBalancer` Service. Prowlarr has no database and no init job to wait
   on, so first deploys are typically quick — **3–7 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep prowlarr | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

   If `EXTERNAL_IP` is empty, the LoadBalancer IP is still provisioning —
   wait a minute and re-run the last command.

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect 1/1 Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/ping"                     # expect {"status":"OK"}
   ```

2. Open `http://$EXTERNAL_IP/` in a browser. Prowlarr ships with **no
   built-in default admin account** — the UI is open by default. If you
   want to require a login, go to **Settings → General → Security** inside
   the app and configure authentication there; this is entirely an
   in-application setting, not something the module provisions for you.

3. (Optional) Add an indexer and connect an *arr application from the
   Prowlarr UI — this catalogue does not currently ship Sonarr/Radarr/etc.
   modules, so this step is a standalone smoke test of Prowlarr's own
   indexer-testing workflow rather than a full end-to-end sync.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   kubectl get pvc -n "$NAMESPACE"
   ```

2. **Scale** — do not raise `max_instance_count` above `1`. Prowlarr's
   embedded SQLite database is a single writer; running multiple replicas
   risks corrupting `/config/prowlarr.db`. `min_instance_count` is already
   `1` by default (no cold starts to worry about).

3. **Update the application version** via the RAD platform's **Update**
   flow. There is no custom build to rebuild — a version bump simply
   redeploys with a new upstream image tag.

4. **Manage the PVC and any custom secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~prowlarr"   # empty by default — Prowlarr generates no secrets
   kubectl get pvc -n "$NAMESPACE"
   kubectl describe pvc -n "$NAMESPACE"
   ```

5. **Back up `/config`** if you need to preserve indexer definitions and
   app-sync connections outside the PVC — Prowlarr has no built-in backup
   job; snapshot the PVC or export from the UI's Settings → System →
   Backup, if enabled.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=100
   ```

   In Cloud Logging, filter:
   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<namespace>"
   resource.labels.container_name="prowlarr"
   ```

2. **Monitoring** — open the GKE Workloads dashboard for the StatefulSet
   and review CPU/memory utilisation (Prowlarr is lightweight; sustained
   high CPU usually means an indexer sync loop or a misbehaving indexer,
   not a platform issue).

3. **Uptime checks** — disabled by default (`uptime_check_config.enabled =
   false`). If you enable it, confirm the `path` was overridden to `/ping`
   — the variable's default `path` is a stale `/api/health` left over from
   this module's clone source and will fail every check if left unchanged.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs. The
  startup probe targets `/ping` with a 15s initial delay and a generous
  10-failure threshold — a genuinely stuck pod, not a slow one, is the
  usual cause.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=200
  ```

- **Trying to deploy Prowlarr on Cloud Run instead:** don't — there is no
  `Prowlarr_CloudRun` module, and there will not be one. The official
  image's s6-overlay init process cannot exec inside Cloud Run's gVisor
  sandbox: three separate live diagnostic deploys (default configuration,
  with an added GCS volume, and with increased CPU/memory) all failed
  identically — zero container output, not even the s6-overlay startup
  banner, and Cloud Run reporting "Application exec likely failed" every
  time. This rules out storage and resource sizing as the cause; it is a
  platform incompatibility with no configuration fix. Use `Prowlarr_GKE`.

- **PVC stuck `Pending`:** check the StorageClass and regional quota.
  `stateful_pvc_storage_class` defaults to `standard` (HDD) specifically to
  avoid the tight `SSD_TOTAL_GB` quota — if you overrode it to
  `standard-rwo`/`premium-rwo` (SSD), verify you have SSD quota headroom.
  ```bash
  kubectl describe pvc -n "$NAMESPACE"
  ```

- **Web UI unreachable / no external IP:** confirm `service_type =
  "LoadBalancer"` was actually set at deploy time — the module's inherited
  default is `ClusterIP`, which never gets an external IP.
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

- **Uptime check always failing after enabling it:** the
  `uptime_check_config` variable's default `path` is a stale `/api/health`
  — override it to `/ping`. This is the one probe-related variable that is
  NOT automatically corrected elsewhere in the module (unlike the pod's own
  startup/liveness probes, which already use `/ping`).

- **403 / permission errors:** verify the Workload Identity binding for the
  namespace's runtime service account.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it, use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources.
Deleting removes everything the module created — the StatefulSet, Service,
PVC (and every indexer/app-sync configuration it held), and the `storage`
GCS bucket. Resources owned by **Services_GCP** (the VPC, GKE cluster,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE StatefulSet with a block PVC and a `LoadBalancer` Service; no database, no init job to wait on |
| 2 — Access & verify | Manual | Pod `1/1 Running`; `/ping` returns `200 {"status":"OK"}`; UI open with no default login unless configured |
| 3 — Operate | Manual | Inspect rollout, understand the `max=1` scaling limit, update version, manage the PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; fix the stale uptime-check path if you enable it |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, and Service-exposure issues; understand why Cloud Run is never the answer here |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and every stored indexer configuration |
