---
title: "Memos on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Memos on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Memos on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Memos is an open-source, self-hosted, markdown-native note-taking service for
quick capture. This lab takes you through the full operational lifecycle of the
**Memos on GKE Autopilot** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Memos product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and create the first (admin) account.
- Perform day-2 operations — inspect, scale, update, and manage backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
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

1. In the RAD platform, open **Memos (GKE)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Kubernetes workload, a Cloud SQL (PostgreSQL)
   database with its Secret Manager password secret, builds the container image,
   and runs a one-shot database-initialisation Job. First deploys take roughly
   **15–25 minutes** (Cloud SQL creation dominates; Memos's own image build and
   boot are fast — a single small Go binary).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep memos | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Open `http://$EXTERNAL_IP/` in a browser (or `kubectl port-forward` if
   `service_type = "ClusterIP"`). Memos shows its sign-up/login page. **Create the
   first account** — whoever registers first automatically becomes the host/admin.
   After creating it, write your first note to confirm the database round-trip
   (the note persists on refresh — proof the `MEMOS_DSN` wiring and `db-init` job
   worked). Consider disabling public self-registration from within Memos's own
   settings afterward.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   kubectl describe hpa -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling is
   a configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply, unless used only as a temporary teardown measure —
   see Task 6).

3. **Update the application version tag** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update deploys. `Memos_Common` maps `"latest"` to a pinned `MEMOS_VERSION` build
   arg, so set an explicit version (e.g. `0.28.0`) to track a specific upstream
   release.

4. **Manage backups:**

   ```bash
   kubectl get jobs -n "$NAMESPACE"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=memos --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard for the deployment and review
   request count, CPU / memory utilisation, and replica count (scaling behaviour).
   The module can provision an **uptime check** (when `uptime_check_config.enabled
   = true`, only meaningful with a publicly reachable `LoadBalancer` Service); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Memos releases.

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs for startup
  errors. The startup probe targets `/` with a 30-second initial delay.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database connection errors (`MEMOS_DSN` parse failures, auth failures):**
  confirm the Cloud SQL instance is `RUNNABLE`, the DB password secret synced via
  SecretSync, and the initialisation Job completed. Check the container logs for
  the `memos-entrypoint.sh` startup banner (`DB host:`/`DB name:`/`DB user:`) —
  on GKE, `DB host` should resolve to `127.0.0.1`.
- **Initialisation Job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Image build failed:** review Cloud Build history for the failed build's log —
  a common cause is `MEMOS_VERSION` resolving to a tag that doesn't exist upstream.
- **403 / permission errors:** verify the Workload Identity binding and the
  runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the "first account becomes admin" behaviour and the
`container_image_source` trade-off).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload,
Service, Cloud SQL database, Secret Manager secret, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL), DB password secret, and runs DB init |
| 2 — Access & verify | Manual | Pod Ready 0 restarts; create the first (admin) account in the UI and write a note |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
