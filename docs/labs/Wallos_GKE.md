---
title: "Wallos on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Wallos on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Wallos on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Wallos is an open-source, self-hosted subscription and recurring-expense tracker
built on plain PHP 8.3 + php-fpm — it tracks recurring subscriptions, converts
prices across currencies, sends renewal notifications, and supports a household
multi-user mode, with no external database. This lab takes you through the full
operational lifecycle of the **Wallos on GKE Autopilot** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Wallos product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  default admin login.
- Understand why this module is fixed to a single always-on replica and must
  never be scaled to zero or beyond one replica.
- Perform day-2 operations — inspect the workload, understand the HDD PVC vs.
  GCS FUSE storage split, and manage ingress.
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

1. Click **Deploy** in the RAD platform top navigation, open **Wallos (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_GKE)
   documents every input by group, with defaults. Note that `min_instance_count`,
   `max_instance_count`, and `stateful_pvc_enabled` are all fixed at their
   sensible defaults (`1`, `1`, `true`) for a real reason — see Task 3 before
   changing them. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   StatefulSet with an HDD block PVC (default) mounted at `/var/www/html/db` for
   the SQLite database, plus a GCS FUSE bucket mounted at
   `/var/www/html/images/uploads/logos` for custom provider logos, then pulls
   the prebuilt `bellamy/wallos` image. There is no Cloud SQL instance, no
   Secret Manager application secret, and no database-initialisation job — Wallos
   is self-contained. First deploys typically complete in **10–15 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep wallos | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running (a single-replica StatefulSet by default) and
   find its address:

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   The Service defaults to `LoadBalancer` (Wallos is a browser-driven web UI), so
   an external IP should appear once the workload is Ready.

2. Confirm the service is healthy. Wallos documents no dedicated health endpoint,
   so the probe (and this check) hits the login page at `/`:

   ```bash
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- -S http://localhost:80/ 2>&1 | head -1
   ```

3. Open the workload in a browser — via the external IP/custom domain, or a
   port-forward:

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8080:80
   # then browse to http://localhost:8080
   ```

   Log in with the seeded default credential **`admin` / `admin`**. Immediately
   change the password under **Settings → Account** — this credential is
   well-known and grants full control of the subscription data.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — statefulset, pods, and PVCs:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Never scale beyond one replica, and never scale to zero.** This is stricter
   than the usual "avoid cold starts" rule of thumb — Wallos runs a real,
   always-on cron daemon (8 baked-in scheduled tasks: exchange-rate refresh,
   renewal notifications, an email-verification poll every 2 minutes, and others)
   that only fires while a pod is running, and its SQLite database has no
   multi-writer support. Leave `min_instance_count = max_instance_count = 1` in
   the RAD platform; a manual `kubectl scale` would be reverted on the next apply
   anyway, and scaling to zero silently stops every scheduled task with no error.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; `bellamy/wallos` is pulled fresh, and
   a rolling update replaces the pod.

4. **Adjust ingress** — toggle `enable_custom_domain` / `application_domains`,
   then apply via **Update**. Avoid disabling `stateful_pvc_enabled` unless you
   have a specific reason — it moves the database from a real block PVC back to
   a GCS FUSE mount, which is a weaker fit for SQLite's write-locking needs.

5. **Inspect the persistent state:**

   ```bash
   # Database (default: block PVC)
   kubectl get pvc -n "$NS"

   # Uploads (always GCS FUSE)
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
   gcloud storage ls gs://<uploads-bucket>/
   ```

   Never delete the database PVC or the `uploads` bucket — doing so destroys
   that state permanently.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. Since Wallos's cron daemon
   runs in-process, its scheduled-task activity is visible only here (there is
   no separate CronJob for it):

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts (should stay at a single, stable pod).
   If `uptime_check_config` is enabled, review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Wallos releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/`; a mount failure or bad image will keep the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Permission denied writing to the database PVC:** `bellamy/wallos`'s runtime
  UID/GID was not confirmed during research, so `stateful_fs_group` defaults
  unset. Inspect the running container to find the actual UID/GID and set
  `stateful_fs_group` accordingly.
  ```bash
  kubectl exec -n "$NS" <pod> -- id
  ```
- **Double-mount at the database path:** if you changed `stateful_pvc_enabled`,
  confirm `enable_gcs_db_volume` was correctly auto-disabled by `Wallos_Common`
  (both mounted at once is a misconfiguration, not a supported state).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # check Volumes / Mounts section
  ```
- **State not persisting across restarts:** confirm `stateful_pvc_mount_path` is
  exactly `/var/www/html/db`; a mismatch stores the DB on ephemeral disk and
  loses state on restart.
- **Renewal notifications or exchange-rate updates stopped arriving:** this
  almost always means the workload was scaled to zero or beyond one replica —
  check `min_instance_count`/`max_instance_count` first, before assuming an
  application-level bug.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the Service/Ingress has an assigned IP if
  `enable_custom_domain = true`.
- **Image pull errors:** confirm the image exists in Artifact Registry (if
  mirrored) and the node service account can pull it; mirrored images use
  `imagePullPolicy = Always`, so a stale local cache is not the cause — check the
  registry and IAM instead.
- **Login shows `admin`/`admin` still active after redeploy:** expected if no
  prior SQLite DB existed at `/var/www/html/db/wallos.db`. If a fresh admin/admin
  prompt appears unexpectedly on a previously-configured deployment, check
  whether the PVC or GCS bucket was replaced/emptied.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `min_instance_count = max_instance_count
= 1`, never delete the database PVC or `uploads` bucket, and let Common manage the
GCS-FUSE/PVC exclusivity for the database path).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and namespace, the database PVC and `uploads` GCS bucket (including the embedded SQLite database and custom logos — this is destructive and unrecoverable), and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet workload, an HDD PVC for the database, and a GCS bucket for uploads; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; log in with seeded `admin`/`admin` and change the password immediately |
| 3 — Operate | Manual | Inspect workload, keep replicas at exactly 1, update version, adjust ingress, inspect persistent state |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, mount, PVC permission, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload, database PVC, and uploads bucket (destructive) |
