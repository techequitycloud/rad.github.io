---
title: "Grocy on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Grocy on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Grocy on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_GKE)**

## Overview

**Estimated time:** 45–75 minutes

Grocy is a self-hosted grocery and household ERP — inventory tracking with
barcode scanning, chore/task management, shopping lists, and meal planning. This
lab takes you through the full operational lifecycle of the **Grocy on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Grocy product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running StatefulSet, including logging in with the
  default credentials and changing them.
- Confirm the block-storage PVC at `/config` is bound and genuinely writable.
- Perform day-2 operations — inspect the StatefulSet, update the version, and
  manage the persistent PVC.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
  depends on).
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

1. In the RAD platform, open **Grocy (GKE)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Grocy_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions a **StatefulSet** (not a plain Deployment — Grocy
   needs stable per-pod storage), a per-pod block-storage PVC (`standard-rwo`,
   20Gi by default) mounted at `/config`, and mirrors the Grocy container image
   into Artifact Registry. There is no database to provision (Grocy uses an
   embedded SQLite database) and no default initialization job. A first deploy
   typically takes **10–20 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep grocy | head -1 | cut -d/ -f2)
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   echo "Service: $SERVICE"
   echo "Pod:     $POD"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy — `1/1 Running` with **0 restarts**, matching what
   was confirmed at live deployment:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect 1/1 Running, 0 restarts
   kubectl get pvc -n "$NAMESPACE"                        # expect Bound
   ```

2. Grocy has no dedicated health endpoint — the login page itself (`200`,
   unauthenticated) is the probe target. If your Service is `ClusterIP` (this
   deployment's default, per `config/deploy.tfvars`), reach it via
   `port-forward`:

   ```bash
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:80 &
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -L "http://localhost:18080/"
   # expect: 200 <nonzero size>
   curl -s -L "http://localhost:18080/" | grep -o '<title>[^<]*</title>'
   # expect: <title>Login | Grocy</title>
   ```

   Or verify directly from inside the pod:

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- curl -s -o /dev/null -w '%{http_code}\n' -L http://localhost:80/
   ```

3. Open the service URL (via `port-forward`, or the LoadBalancer IP if you
   deployed with `service_type = "LoadBalancer"`) in a browser. Log in with
   Grocy's built-in default credentials — **`admin` / `admin`** — there is no
   pre-seeded credential in Secret Manager to look up; the upstream image ships
   this default outright.

4. **Immediately change the admin password.** Go to the user menu → **Manage
   users** → edit `admin` → set a new password. If the module is exposed
   externally (`service_type = "LoadBalancer"`), leaving the default credentials
   in place on a live deployment is a real exposure.

5. Add one real item — e.g. a product under **Master data → Products**, or a
   chore under **Chores** — and confirm it appears in the relevant list view.
   This is the stateful write that proves the `/config` block PVC is genuinely
   writable and durable, not just that the login page rendered.

6. **Confirm the block PVC is genuinely writable** (the same fact the boot log
   already demonstrated via TLS-key generation under `/config/keys`):

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /config
   # expect: grocy.db, config.php, keys/, data/ — all owned by uid 1000
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the StatefulSet and its rollout history:**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   kubectl describe statefulset "$SERVICE" -n "$NAMESPACE"
   ```

2. **Scaling is intentionally locked to one instance.** Unlike most modules in
   this catalogue, do not raise `max_instance_count` above `1` — Grocy's
   embedded SQLite database is single-writer with no clustering support, and
   because the StatefulSet uses `volumeClaimTemplates`, a second replica would
   get its own disconnected PVC rather than sharing `/config`.

3. **Update the application version tag** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds (pinned
   via the `GROCY_VERSION` build ARG, not the generic `APP_VERSION`) and the
   StatefulSet performs a rolling update. The `/config` PVC is untouched by an
   image update — that's the point of a StatefulSet's stable per-pod storage.

4. **Inspect the persistent `/config` PVC:**

   ```bash
   kubectl get pvc -n "$NAMESPACE"
   kubectl describe pvc <pvc-name> -n "$NAMESPACE"
   ```

5. **Back up `/config` manually if needed** — there is no automated backup job
   specific to Grocy in this module; use the platform's generic
   `backup_schedule` / `enable_backup_import` inputs, or snapshot the
   underlying Persistent Disk directly via the Console (Compute Engine → Disks).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" "$POD" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   A clean boot shows the s6-overlay/LinuxServer startup sequence completing
   with `[ls.io-init] done.` and no permission errors around `/config`.

2. **Monitoring** — open the GKE Workloads dashboard for the StatefulSet and
   review CPU/memory utilisation and replica count (should stay at exactly `1`).
   The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Grocy releases.

- **Pod stuck `Pending` — PVC not binding.** Confirm the StorageClass exists and
  the regional SSD/Balanced-PD quota isn't exhausted:
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc <pvc-name> -n "$NAMESPACE"
  ```
- **Pod `CrashLoopBackOff` with permission errors on `/config`.** This would
  indicate a `stateful_fs_group` mismatch against Grocy's UID/GID (1000/1000) —
  the module default (`1000`) already matches, but check if this was overridden:
  ```bash
  kubectl describe pod -n "$NAMESPACE" "$POD"
  kubectl logs -n "$NAMESPACE" "$POD" --tail=200
  ```
- **Revision unhealthy / Service won't serve:** inspect the pod and its logs
  for startup errors, and confirm the PVC attached successfully.
  ```bash
  kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" "$POD" --tail=100
  ```
- **Login page loads but data doesn't persist across a pod restart:** this
  indicates the PVC is not actually bound/mounted correctly — re-check
  `kubectl get pvc` and the StatefulSet's `volumeClaimTemplates` rather than
  assuming an application bug.
- **Build failures on deploy or version update:** review Cloud Build history
  for the failed build's log.
- **403 / permission errors:** verify the pod's Workload Identity binding and
  its IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it (for example after manual changes that conflict
with the Terraform state), use **Purge** instead — it removes the deployment
from RAD's records **without** destroying the cloud resources (it makes RAD
forget the project). Deleting removes everything the module created — the
StatefulSet, the Kubernetes Service, the block-storage PVC (and its underlying
Persistent Disk), the Cloud Storage `storage` bucket, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the StatefulSet, a block-storage PVC at `/config`, and mirrors the container image |
| 2 — Access & verify | Manual | Pod `1/1 Running`, 0 restarts; PVC Bound; health check passes; log in with `admin`/`admin`, change the password, write one real item |
| 3 — Operate | Manual | Inspect the StatefulSet, update version, confirm scaling stays at 1, inspect/back up the PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring |
| 5 — Troubleshoot | Manual | Diagnose PVC binding, permission, StatefulSet, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and its backing disk |
