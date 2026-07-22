---
title: "Trilium on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Trilium on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Trilium on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Trilium Notes (the actively maintained TriliumNext fork) is a hierarchical,
self-hosted note-taking application with an embedded SQLite database. This lab
takes you through the full operational lifecycle of the **Trilium on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Trilium product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, discover the namespace, and confirm the pod is running.
- Access the app, verify its health endpoint, and complete the first-run "Set Password" step.
- Perform day-2 operations — inspect the workload, choose between GCS FUSE and block-PVC storage, and update the version.
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

1. Click **Deploy** in the RAD platform top navigation, open **Trilium (GKE)** from
   the **Platform Modules** list, set `project_id`, and review the inputs. Configure
   only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin wrapper image over `triliumnext/notes` (mirrored into
   Artifact Registry via Cloud Build) and schedules a single pod onto the GKE
   Autopilot cluster (port 8080, 1 vCPU / 1 GiB by default), exposed via an external
   **LoadBalancer** Service by default. The data directory is a **GCS FUSE** volume
   mounted at `/home/node/trilium-data`; setting `stateful_pvc_enabled = true`
   switches to a **StatefulSet with a block PVC** instead. There is **no Cloud SQL
   instance and no Redis** — Trilium's document store is entirely an embedded
   SQLite database on the mounted volume. First deploys typically take **5–10
   minutes** (the image build and pod scheduling dominate; there is no database to
   wait for).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep trilium | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is Ready and get the external IP (the module defaults to
   `service_type = LoadBalancer`, so Trilium is reachable from a browser out of the
   box):

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "http://$EXTERNAL_IP"
   ```

2. Verify the health endpoint — note this is **not** the root path:

   ```bash
   curl -s "http://$EXTERNAL_IP/api/health-check"   # expect {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"   # expect 302 (redirect to setup)
   ```

   If the external IP isn't ready yet, port-forward directly to the pod instead:

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s http://localhost:8080/api/health-check
   ```

3. Open the app in a browser. On first visit Trilium presents a **"Set Password"**
   screen — there is no pre-seeded admin credential in Secret Manager, unlike apps
   with an auto-generated password. Choose a strong password and complete the setup
   immediately, since the LoadBalancer IP is public by default.

4. Verify persistence: create a note, then reload the page and confirm it's still
   there — everything lives in the mounted volume, whichever mode is active:

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~trilium"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — a Deployment by default, or a StatefulSet when
   `stateful_pvc_enabled = true`:

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale out.** The module deliberately pins
   `min_instance_count = max_instance_count = 1`: the embedded SQLite database has
   no multi-writer support — a second replica risks corrupting `document.db`.
   Resource changes go through **Update** on the deployment details page, not
   manual `kubectl edit` (a manual edit would be reverted on the next apply).

3. **Choose your storage mode deliberately.** GCS FUSE (default) is simplest and
   needs no PVC quota planning; `stateful_pvc_enabled = true` mounts a per-pod block
   PVC (`standard`/HDD, `20Gi` by default) for real POSIX file locking on the
   embedded SQLite database, auto-selects `StatefulSet`, and sets
   `stateful_fs_group = 1000` so the volume is writable by Trilium (uid/gid 1000).
   Switching modes is a one-way infrastructure change — plan a data copy if you need
   to migrate an existing data directory between the two.

4. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds and a rolling update replaces
   the pod. Trilium applies its own schema migrations on start.

5. **There is no database session to open.** `database_type = "NONE"` — no Cloud
   SQL instance, no db-init job, no database password. The only durable state is
   the data volume.

6. **Back up the notes:**

   ```bash
   # GCS FUSE mode:
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~trilium" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$DATA_BUCKET" "gs://<your-backup-bucket>/trilium-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/node/trilium-data ./trilium-backup-$(date +%F)
   ```

   Trilium also has its own in-app export/backup feature (Menu → Export) for a
   single-note or whole-tree `.zip` export, independent of the infrastructure-level
   copy above.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Use `statefulset/<name>` instead of `deploy/<name>` when `stateful_pvc_enabled =
   true`.) Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts. The module's **uptime check** is disabled
   by default (`uptime_check_config.enabled = false`); enable it explicitly against
   `/api/health-check` if you want Monitoring → Uptime checks to track availability.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Trilium releases.

- **Pod not Ready / restart-looping on the probe:** check whether a custom
  `startup_probe`/`liveness_probe` was pointed at `/` instead of the default
  `/api/health-check` — `/` returns a 302 redirect, which most probes treat as a
  failure.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe-failure details
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **App unreachable from your browser:** confirm the Service type is
  `LoadBalancer` (the default) and that an external IP has actually been assigned —
  it can take a minute or two after first deploy:
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **PVC stuck Pending (block PVC mode):** check for `DISKS_TOTAL_GB` vs
  `SSD_TOTAL_GB` quota — the module defaults `stateful_pvc_storage_class` to
  `"standard"` (HDD) specifically to avoid the tight SSD quota; if you overrode it
  to `standard-rwo`/`premium-rwo`, check SSD quota instead.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Data directory permission errors:** confirm `stateful_fs_group` is `1000`
  (default) for PVC mode, or the GCS `mount_options` include `uid=1000,gid=1000`
  for GCS FUSE mode — Trilium runs as uid 1000/gid 1000 (the `node` user).
- **"Set Password" screen reappears on every visit:** the SQLite database isn't
  persisting — confirm the volume mount survived a rollout (check for a
  `document.db` file in the bucket or via `kubectl exec ... ls`).
- **Image build failed:** review Cloud Build history for the failed build's log;
  the image is a thin wrapper over `triliumnext/notes`.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to complete "Set Password" immediately for
any publicly reachable deployment).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload and
namespace, the data storage (the GCS bucket, or the block PVC and its underlying
Persistent Disk), and Artifact Registry images. Copy the notes out first (Task 3,
step 6) if you want to keep them. Resources owned by **Services_GCP** (the VPC, GKE
cluster, Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions the GKE pod and the data storage (GCS FUSE or block PVC; no DB, no Redis) |
| 2 — Access & verify | Manual | Health check passes on `/api/health-check`; complete the first-run "Set Password" step; verify note persistence |
| 3 — Operate | Manual | Inspect the workload, keep single-instance scaling, choose GCS FUSE vs block PVC, update version, back up notes |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose probe-path, ingress, PVC-quota, permission, and persistence issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the data storage |
