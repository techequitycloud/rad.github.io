---
title: "UrBackup on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy UrBackup on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# UrBackup on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)**

## Overview

**Estimated time:** 60–90 minutes

UrBackup is an open-source client/server network backup system for Windows,
Linux, and macOS: file-level and full disk-image backups, client-side
deduplication via hardlinks, and a web management UI. This module deploys the
UrBackup **server** on GKE Autopilot with its persistent data (server database
+ all client backup data) on a single GKE block Persistent Volume, plus a
dedicated multi-port Kubernetes Service so real backup client agents — running
on users' own PCs, entirely outside this GCP project — can dial in on the raw
TCP/UDP ports the backup protocol needs. This lab takes you through the full
operational lifecycle of the **UrBackup on GKE Autopilot** module: deploy it,
verify it's reachable, connect a real client, operate it day-to-day, observe
it, diagnose common problems, and tear it down.

**There is no Cloud Run variant of this module and there never will be.**
UrBackup's client protocol needs three raw TCP ports (`55413`, `55414`,
`55415`) plus UDP LAN-discovery broadcast (`35622`-`35623`) simultaneously
reachable. Cloud Run's ingress is single-port HTTP(S)-only and cannot expose
raw multi-port TCP or any UDP at all. This is a permanent architectural
decision, the same class as this catalogue's other Common+GKE-only modules
(Kopia, RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible,
LobeChat, Supabase, Woodpecker).

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on UrBackup's own backup-configuration features beyond what's needed to
prove the deployment works end to end. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)
— this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions, including the persistent block volume and the dedicated
  multi-port Service.
- Understand why UrBackup's persistent data lives on a single block PVC
  (not GCS) and why that matters for capacity planning.
- Access the web UI, complete the first-run admin setup wizard, and confirm
  the server is genuinely ready to accept client connections.
- Perform day-2 operations — inspect the workload, the PVC, and the
  multi-port Service; update the version; understand the single-instance
  scaling limit.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and connectivity issues.
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
- (Optional, for a full client round-trip) **A real or virtual machine you can
  install the UrBackup client on** — Windows, Linux, or macOS.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **UrBackup
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. **Before deploying, set
   `stateful_pvc_size`** to something realistic for this lab (the 200Gi
   default is fine for a pilot/lab run, but review it — this module holds
   real backup data, not just app config). Configure anything else you need
   — the [Configuration Guide](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds a thin-wrapper container image (the official UrBackup
   server image with a build-time entrypoint patch redirecting backup
   data onto the mounted PVC), provisions a GKE
   block Persistent Volume Claim, and provisions a dedicated multi-port
   `LoadBalancer` Service for real backup clients (beyond the standard
   single-port Foundation Service, which stays internal-only). First-deploy
   time is typically **8–12 minutes**.

3. Connect to the cluster and discover the namespace with a name-agnostic
   filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep urbackup | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   kubectl get pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"                 # expect 1/1 Running
   ```

2. Confirm the persistent volume is bound and check the backup-data redirect:

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" "$POD" -- cat /var/urbackup/backupfolder
   # Should read /var/urbackup/backups
   kubectl exec -n "$NS" "$POD" -- ls -la /var/urbackup
   ```

3. Find the dedicated multi-port Service's external IP (this is what real
   clients dial, NOT the Foundation-managed Service's own IP):

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.metadata.name contains "client-ports")].status.loadBalancer.ingress[0].ip}')
   # If the jsonpath filter above doesn't match your kubectl version, just read it from the list:
   kubectl get svc -n "$NS" -o wide | grep client-ports
   ```

   If the `EXTERNAL-IP` column shows `<pending>`, wait a few minutes and
   re-check — GCP LoadBalancer provisioning is asynchronous and this module
   does not block the apply waiting for it.

4. **Open the web UI** at `http://<EXTERNAL_IP>:55414` and complete the
   first-run setup wizard to create the admin account — there is no
   pre-seeded credential for this image; this is expected, not a bug.
   Confirm you land on the authenticated dashboard.

5. **(Optional) Connect a real client.** Install the UrBackup client on a
   test machine, point it at `<EXTERNAL_IP>` (or add it manually from the
   server's web UI under **Settings → Add new client**), and trigger a
   manual backup. Confirm the backup appears in the server's **Status** /
   **Backups** view — this proves the persistent volume, port reachability,
   and the client-server protocol all work end to end, not just that the
   server booted.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its PVC:**

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl logs -n "$NS" "$POD" --tail=100
   ```

2. **Check PVC usage as your client fleet grows** — this is the single most
   important day-2 metric for this module:

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/urbackup
   ```

   If usage approaches capacity, increase `stateful_pvc_size` via the RAD
   platform's **Update** flow (PVC expansion is typically online for GKE's
   default StorageClasses — confirm the resize completed with `kubectl get
   pvc -n "$NS"`).

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**. A new image builds and
   the pod is recreated; the persistent volume (and everything on it) is
   untouched.

4. **Do not scale beyond one instance.** `max_instance_count` is effectively
   hard-capped at `1` — the embedded SQLite database and hardlink-based
   deduplication have no multi-instance coordination.

5. **Do not scale to zero for long periods.** `min_instance_count` defaults
   to `1` deliberately — real clients dial in on their own unattended
   schedule at arbitrary times, and a scaled-to-zero server would silently
   miss those check-ins.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100 -f
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard and review pod CPU,
   memory, and the PVC's disk utilisation over time as client backups
   accumulate. `uptime_check_config` is **disabled by default**.

3. **Client backup activity** — the most useful "is this actually working"
   signal is the server's own web UI **Status** page, which lists every
   registered client and its last-backup timestamp.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod stuck `Pending`:** check for PVC provisioning issues first — this
  module requests a potentially large HDD (`standard`) PVC:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
  A `Pending` PVC with a quota-exceeded event means the project's
  `DISKS_TOTAL_GB` (or, if you changed `stateful_pvc_storage_class` to an
  SSD class, `SSD_TOTAL_GB`) quota is exhausted — reduce `stateful_pvc_size`
  or request a quota increase.

- **Pod running but the web UI is unreachable:** check whether you're
  waiting on the dedicated multi-port Service's external IP, not the
  Foundation-managed Service (which is `ClusterIP` by default and was never
  meant to be externally reachable for this module):
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```

- **File permission errors in logs (`/var/urbackup` not writable):** check
  ownership and PUID/PGID alignment:
  ```bash
  kubectl exec -n "$NS" "$POD" -- ls -la /var/urbackup
  kubectl exec -n "$NS" "$POD" -- id
  ```
  If you're reusing storage from a prior non-containerized UrBackup install,
  `urbackup_puid`/`urbackup_pgid` may need to match the UID/GID that
  originally owned that data.

- **Client can't discover or connect to the server:** confirm ALL FIVE ports
  are actually reachable, not just the web UI port — the LAN-discovery UDP
  ports in particular are easy to overlook when testing from outside the
  local network (UDP broadcast discovery generally does not work across the
  internet at all; use the client's manual "Internet Server" connection mode
  and just the TCP ports for remote clients):
  ```bash
  kubectl get svc -n "$NS" -o wide
  # Confirm 55413, 55414, 55415/tcp and 35622-35623/udp are all listed on
  # the *-client-ports Service, not just 55414.
  ```

- **Multiple replicas / scaling attempted:** don't — the embedded SQLite
  database and hardlink-based deduplication do not support concurrent server
  instances. Keep `max_instance_count = 1`.

- **Trying to deploy UrBackup on Cloud Run instead:** don't — there is no
  `UrBackup_CloudRun` module, and there will not be one. Cloud Run's
  single-port HTTP(S)-only ingress cannot expose UrBackup's raw multi-port
  TCP + UDP client protocol under any configuration. Use `UrBackup_GKE`.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including PVC sizing/storage-class guidance and
the client-connectivity outputs to use).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload, namespace, the dedicated multi-port Service, and the
persistent volume (**all backup data on it is deleted with it** — see below).
Resources owned by **Services_GCP** (the VPC, GKE cluster, registry) are
managed separately and are not removed here.

> **Before tearing down**, understand that ALL registered clients' backup
> history lives entirely on the block PVC this module provisions — deleting
> the deployment deletes that PVC along with everything else, with no
> separate export/migration step built into this module. If you need to
> preserve backup data, snapshot the underlying persistent disk
> (`gcloud compute disks snapshot`) before tearing down.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the thin-wrapper image, provisions the block PVC, and deploys the workload plus the dedicated multi-port Service |
| 2 — Access & verify | Manual | Confirm the PVC and symlinks, find the client-facing external IP, complete first-run admin setup, optionally connect a real client |
| 3 — Operate | Manual | Inspect the workload/PVC, monitor disk usage as the fleet grows, update the version, understand the single-instance limit |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and PVC disk usage; check client backup status in the web UI |
| 5 — Troubleshoot | Manual | Diagnose PVC quota, Service/connectivity, permission, and scaling issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the persistent volume and ALL backup data on it |
