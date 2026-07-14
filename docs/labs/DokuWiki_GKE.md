---
title: "DokuWiki on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy DokuWiki on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# DokuWiki on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE)**

## Overview

**Estimated time:** 45–90 minutes

DokuWiki is a lightweight, standards-compliant **flat-file wiki** — it stores all
pages, media, users, and configuration as files on disk, with no database. This lab
takes you through the full operational lifecycle of the **DokuWiki on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on DokuWiki product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale (deliberately not), update, and manage
  the block PVC that holds all wiki content.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
  DokuWiki uses no database, so Cloud SQL is not required for this module.
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

1. Click **Deploy** in the RAD platform top navigation, open **DokuWiki (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys DokuWiki into the GKE Autopilot cluster as a
   **StatefulSet** backed by a durable block PersistentVolumeClaim mounted at
   `/storage` (default `10Gi`), and builds/mirrors the container image. There is
   **no database** (`database_type = "NONE"`), **no Redis**, and **no runtime
   secrets** — the admin account is created interactively later, via the
   installer. First deploys typically take **10–20 minutes** (no Cloud SQL
   provisioning to wait on).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dokuwiki | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the StatefulSet pod is running and find the wiki's external address:

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the wiki is healthy. Startup, liveness, and readiness probes all target
   `/`, which DokuWiki serves without authentication — the pod becomes Ready as
   soon as Apache is up (no database migrations to wait for):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}/install.php` in a browser to run the **first-run
   installer** — set the wiki title, create the administrator account, and choose
   the ACL policy. The account is written straight to the `/storage` PVC; there is
   no pre-seeded admin credential anywhere in Secret Manager. **Immediately after
   setup, block `install.php` from further access** — anyone who reaches it before
   you finish setup can claim the admin account. `install.php` ships as part of
   the DokuWiki image's web root (not on the `/storage` PVC), so it survives pod
   restarts; block it at the load balancer / ingress layer (a path-based deny
   rule) or via a follow-up image change, rather than trying to delete it from the
   running container.

   ```bash
   kubectl get ingress -n "$NS"          # check for an ingress you can add a deny rule to
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the bound PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale past 1 replica.** Each StatefulSet pod gets its own separate
   PVC — DokuWiki has no built-in clustering or shared storage, so a second
   replica does not mirror the first; it starts an empty wiki. Keep
   `min_instance_count` / `max_instance_count` at `1` in the RAD platform for a
   shared wiki. Scaling (if ever needed for a deliberate multi-wiki use case) is a
   configuration change via **Update**, not a manual `kubectl scale` — the module
   owns the workload spec and a manual edit would be reverted on the next apply.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and rolls out.
   DokuWiki has no migration step — the new engine reads the same `/storage` data.

4. **Inspect the PVC and browse wiki content:**

   ```bash
   kubectl describe pvc -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /storage/data/pages
   kubectl exec -n "$NS" "$POD" -- du -sh /storage
   ```

5. **Back up the wiki** before any risky change (there is no database to dump —
   the PVC is the entire wiki):

   ```bash
   kubectl exec -n "$NS" "$POD" -- tar czf /tmp/dokuwiki-backup.tar.gz -C /storage .
   kubectl cp "$NS/$POD:/tmp/dokuwiki-backup.tar.gz" ./dokuwiki-backup.tar.gz
   ```

6. **Confirm there are no secrets or jobs to manage** (both are true by design for
   this module):

   ```bash
   kubectl get secrets -n "$NS"
   kubectl get jobs -n "$NS"          # expect none — no init job for DokuWiki
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC disk usage. The module can
   provision an **uptime check** (when the endpoint is publicly reachable); review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with DokuWiki releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Because the probe
  targets `/` with no auth and no database dependency, a Ready failure almost
  always points to a scheduling, image-pull, or PVC-mount problem rather than an
  application error.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pending pod / PVC not binding:** check the PVC status and events; on a
  quota-constrained project a StorageClass defaulting to SSD can exhaust the
  regional SSD quota faster than expected.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Wiki content "reset" or empty after a change:** confirm you did not delete or
  replace the PVC (or the StatefulSet along with its PVC) — the PVC *is* the
  wiki. Recreating the StatefulSet alone does not touch the PVC, but deleting the
  PVC or the whole namespace does.
- **Multiple replicas show different content:** this is expected, not a bug — each
  StatefulSet pod has its own PVC. Scale back to 1 replica for a shared wiki.
- **`install.php` still reachable / admin not created:** revisit Task 2 — confirm
  the installer actually ran and wrote to `/storage`, and that the file was
  removed or blocked afterward.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule to keep `database_type =
"NONE"`, never change `stateful_pvc_mount_path` away from `/storage`, and never
set `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload,
namespace, and the block PVC holding all wiki content (back it up first if you
need to keep it — see Task 3), plus the Artifact Registry images. Resources owned
by **Services_GCP** (the VPC, GKE cluster, shared registry) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a StatefulSet with a block PVC (`/storage`) and builds the image; no database, no secrets |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; run the `/install.php` wizard and then block it |
| 3 — Operate | Manual | Inspect workload, keep replicas at 1, update version, browse/back up the PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, replica-content, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload and PVC — back up content first |
