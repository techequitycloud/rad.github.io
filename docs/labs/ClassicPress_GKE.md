---
title: "ClassicPress on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy ClassicPress on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ClassicPress on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE)**

## Overview

**Estimated time:** 45–90 minutes

ClassicPress is a free, open-source, business-focused CMS — a lightweight fork of
WordPress 4.9.x that preserves the classic (pre-Gutenberg) editing experience, with
plugins, themes, a media library, and a REST API. This lab takes you through the full
operational lifecycle of the **ClassicPress on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
ClassicPress product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and complete the first-run ClassicPress installer.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Understand how the StatefulSet PVC provides the persistence Cloud Run lacks.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **ClassicPress (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin custom image (`FROM classicpress/classicpress`) via
   Cloud Build, deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** with a per-pod 10Gi `standard-rwo` block PVC mounted at
   `/var/www/html`, provisions a Cloud SQL for MySQL 8.0 database with its Secret
   Manager secrets (`CLASSICPRESS_SALT_SEED` and the database password), a
   Filestore (NFS) instance (`enable_nfs = true` by default), a `classicpress-uploads`
   Cloud Storage bucket, and runs a one-shot database-initialisation job (`db-init`)
   that creates the application database and user. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep classicpress | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is reachable:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   # expect 200 (already installed) or 302 (redirect to the first-run installer)
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On a fresh database, ClassicPress
   redirects to `/wp-admin/install.php` — complete the installer (site title, admin
   username, password, and email) to create the schema and the admin account. There
   is **no pre-seeded admin credential** in Secret Manager; the installer is the only
   way to set one. Because the install lives on the StatefulSet PVC (not ephemeral
   container storage), it persists across pod restarts once created.

4. Log in at `http://${EXTERNAL_IP}/wp-login.php` with the account you just created
   and confirm the dashboard loads.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Keep `max_instance_count = 1`: `stateful_pvc_enabled
   = true` gives each StatefulSet pod its **own** PVC, so a second replica would run
   its own separate, unsynced copy of the install rather than sharing one.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pod. NFS-backed apps normally use `Recreate` deployment strategy on
   this foundation, but ClassicPress's primary persistence here is the PVC, not NFS —
   confirm the rollout completes cleanly:

   ```bash
   kubectl rollout status statefulset/<service-name> -n "$NS"
   ```

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~classicpress"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=classicpress --project="$PROJECT"
   ```

6. **Why this variant does not hit the Cloud Run media-persistence bug.** The
   `ClassicPress_Common` Dockerfile and `entrypoint.sh` never reference any NFS or
   Foundation-level mount path — that fact is identical on both platforms. On
   **Cloud Run**, the confirmed bug is that `/var/www/html` (where the upstream
   entrypoint writes `wp-config.php` and copies the whole application, including
   `wp-content/uploads`) sits on ephemeral, per-instance storage with no volume
   covering it, so scale-to-zero cold starts lose uploaded media and admin-installed
   plugins/themes. On **GKE**, the *Application module* (not the Common layer)
   separately sets `stateful_pvc_enabled = true` with
   `stateful_pvc_mount_path = /var/www/html` — the exact directory the entrypoint
   populates — so the install (code, plugins, themes, and uploads) persists across
   pod restarts and rescheduling by construction. `enable_nfs = true` is still the
   default here too, mounting Filestore at `/var/lib/classicpress`, a path this layer
   still never uses — treat it as spare, currently-unused shared storage, not the
   thing making persistence work.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. Also check PVC usage
   under Kubernetes Engine → Storage as the media library grows. The module can
   provision an uptime check (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ClassicPress releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  is TCP on port 80 with a generous `failure_threshold = 20`, allowing time for the
  upstream entrypoint to populate an empty PVC on first boot; the liveness probe is
  HTTP `GET /` with a 300-second initial delay.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Site re-shows the first-run installer unexpectedly:** on this variant, the
  install lives on the StatefulSet PVC, so this should not happen from ordinary pod
  restarts — if it does, check whether the PVC was recreated (a deleted/replaced PVC
  loses the whole install, including `wp-config.php`) rather than assuming it is the
  same cold-start bug documented for Cloud Run:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, and
  that the `db-init` job completed. Pods reach Cloud SQL through the Auth Proxy
  sidecar on `127.0.0.1:3306` (`enable_cloudsql_volume = true`, required on GKE) —
  no public IP is exposed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues (including the `SSD_TOTAL_GB` quota the default `standard-rwo` PVC
  draws from), and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rule never to rotate
`CLASSICPRESS_SALT_SEED` after first boot, and the `stateful_pvc_storage_class`
SSD-vs-HDD quota trade-off).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload,
namespace, and PVC, Cloud SQL database, Secret Manager secrets, Filestore instance,
GCS bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet + PVC, Cloud SQL (MySQL 8.0), Filestore, secrets, storage bucket, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; reachability check passes; complete the first-run installer to create the admin account |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, scale, update version, manage secrets/storage, DB access; understand why the PVC avoids the Cloud Run persistence bug |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and PVC usage |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
