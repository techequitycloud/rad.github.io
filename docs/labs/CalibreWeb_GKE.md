---
title: "Calibre-Web on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Calibre-Web on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Calibre-Web on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Calibre-Web is a self-hosted web app for browsing, reading, and downloading ebooks
from a Calibre library — it serves an in-browser reader, an OPDS feed, and Kobo
sync on top of the upstream LinuxServer.io image. This lab takes you through the
full operational lifecycle of the **Calibre-Web on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Calibre-Web product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect the StatefulSet and PVC, and manage the admin login.
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

1. Click **Deploy** in the RAD platform top navigation, open **Calibre-Web (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE)
   documents every input by group, with defaults. If you want the web UI reachable
   externally out of the box, set `application_domains` to a hostname or switch
   `service_type` to `LoadBalancer` before deploying (see Task 2). Review the
   estimated cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform builds and mirrors the container image (pinned to a known-good
   `0.6.24` tag when `application_version = "latest"`), deploys a **StatefulSet**
   into the GKE Autopilot cluster (auto-selected because `stateful_pvc_enabled =
   true`), provisions a per-pod block Persistent Volume Claim mounted at `/config`,
   and a Secret Manager secret (`CALIBRE_ADMIN_PASSWORD`). There is no database and
   no initialisation job — Calibre-Web manages its own SQLite storage on first
   boot. First deploys typically take **5–15 minutes** (mostly the container
   build and PVC provisioning).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep calibreweb | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running:

   ```bash
   kubectl get statefulset,pods -n "$NS"
   ```

2. Find how to reach it. `service_type` defaults to **`ClusterIP`** (internal-only),
   and while `enable_custom_domain = true` by default provisions a Gateway API
   resource, the default empty `application_domains = []` leaves it with no
   hostname to route — so **there is no external access configured out of the box**
   unless you set `application_domains` or switched `service_type` to
   `LoadBalancer` before deploying:

   ```bash
   kubectl get svc,gateway,httproute -n "$NS"
   # If service_type = LoadBalancer:
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   # If ClusterIP only, port-forward for this lab:
   kubectl port-forward -n "$NS" svc/<service-name> 8083:8083
   ```

3. Confirm the service is healthy. Calibre-Web's startup and liveness probes both
   target the root path, which serves the login page unauthenticated:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP:-localhost}:8083/"   # expect 200
   ```

4. Open the address in a browser. Sign in with the upstream image's built-in
   default credentials — **`admin` / `admin123`** — the auto-generated
   `CALIBRE_ADMIN_PASSWORD` secret in Secret Manager is **not** wired into the
   container's login flow. Immediately after first sign-in, change the admin
   password in the Calibre-Web UI (Admin → Edit User); optionally use the
   generated secret's value as the new password:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Point Calibre-Web at your ebook library: use the in-app setup wizard to set the
   library location to `/books` (empty on first run — upload or sync ebooks into it
   afterwards).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload, its PVC, and the PodDisruptionBudget:**

   ```bash
   kubectl get statefulset,pods,pvc,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not raise `max_instance_count` above `1`.** The StatefulSet's
   `volumeClaimTemplates` give each replica its own, independent PVC — scaling up
   does **not** share `/config` across pods; it silently forks the library and
   config into separate, unsynchronised copies per pod. Scaling is a configuration
   change in the RAD platform (change the min/max instance inputs and click
   **Update**), not a manual `kubectl scale` — a manual edit would be reverted on
   the next apply.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (pinned via the
   app-specific `CALIBREWEB_VERSION` build ARG) and a rolling update replaces the
   pod.

4. **Inspect the `/config` PVC and its backing disk:**

   ```bash
   kubectl describe pvc -n "$NS" -l app=<service-name>
   gcloud compute disks list --project="$PROJECT" --filter="name~calibreweb"
   ```

   The default StorageClass (`standard-rwo`) is SSD-backed and draws the tight
   regional `SSD_TOTAL_GB` quota; consider `stateful_pvc_storage_class = "standard"`
   (HDD) if you are running a campaign of stateful GKE apps in the same project.
   Scaling the workload to zero does **not** release the PVC — only deleting it
   (or the namespace) does.

5. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~calibreweb"
   kubectl get jobs -n "$NS"   # only user-supplied jobs, if any
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC usage. Uptime checks are
   **disabled by default** (`uptime_check_config.enabled = false`) — enable one in
   the RAD platform if you want automated availability alerting (requires external
   access to be configured, per Task 2).

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Calibre-Web releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/` (the login page, `200`, no authentication required) with a generous
  `failure_threshold=10` at `period=10s`, so a slow-starting container still has
  time to pass.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Login fails with the built-in credentials:** confirm you are using
  `admin` / `admin123` (the upstream default), not the `CALIBRE_ADMIN_PASSWORD`
  Secret Manager value — that secret is provisioned but not applied to the
  container's actual login flow.
- **No external access at all:** the default `service_type = ClusterIP` combined
  with empty `application_domains` leaves no route in — this is expected out of
  the box (see Task 2), not a failure. Set `application_domains` or switch to
  `LoadBalancer` and re-apply.
- **PVC stuck `Pending` / `SSD_TOTAL_GB` quota exceeded:** check current disk usage
  and consider switching `stateful_pvc_storage_class` to `standard` (HDD) on a
  quota-constrained project; remember scale-to-zero does not free existing PVCs.
  ```bash
  kubectl describe pvc -n "$NS"
  gcloud compute disks list --project="$PROJECT"
  ```
- **Suspected data-fork after a scale-up:** if `max_instance_count` was ever raised
  above `1`, each pod holds an independent, unsynchronised `/config` — check
  `kubectl get pvc -n "$NS"` for multiple PVCs and reconcile by choosing one pod's
  data as authoritative before scaling back to `1`.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas. Note two confirmed documentation-vs-source mismatches to be aware of
while troubleshooting: the `liveness_probe` variable's description text (inherited
from the shared foundation) mentions a `/health` endpoint that Calibre-Web does not
expose (the actual configured path is `/` — do not change it to `/health`), and the
Cloud Run sibling module's `calibreweb_url` output description contains an
unrelated stale copy-paste reference to a "REST API (port 6333)" — not applicable
to the GKE variant's `service_url` output, which is simply the normal address to
reach the workload per `service_type`.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the per-pod PVC (and its underlying disk, along with your ebook
library and Calibre-Web's SQLite databases, since they live only on that volume),
the `CALIBRE_ADMIN_PASSWORD` secret, and Artifact Registry images. Resources owned
by **Services_GCP** (the VPC, GKE cluster, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a StatefulSet with a per-pod block PVC at `/config`, a Secret Manager admin-password secret; no database |
| 2 — Access & verify | Manual | Connect to the cluster; confirm/configure external access; sign in with `admin`/`admin123` and change the password immediately |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep `max_instance_count=1`, update version, watch SSD quota |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics (uptime check optional, off by default) |
| 5 — Troubleshoot | Manual | Diagnose pod, login, ingress, PVC/quota, and image-pull issues; two known doc/source mismatches noted |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and its disk with the ebook library and SQLite state |
