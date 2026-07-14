---
title: "Uptime Kuma on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Uptime Kuma on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Uptime Kuma on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Uptime Kuma is a self-hosted uptime monitoring tool for websites, APIs, TCP ports, and DNS records, with status pages and 90+ notification channels. This lab takes you through the full operational lifecycle of the **Uptime Kuma on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Uptime Kuma product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, find the Uptime Kuma workload, and verify it is healthy.
- Explain why this module has no Cloud SQL instance and no Secret Manager entries, and why all durable state lives on a single Filestore (NFS) share.
- Perform day-2 operations — inspect the workload, understand why it must stay at a single replica, update the version, and check the NFS-backed data.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the known SQLite-over-NFS limitation.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Filestore/NFS networking, Artifact Registry, and shared service accounts
  this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **UptimeKuma (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform schedules the workload onto the GKE Autopilot cluster, provisions no
   Cloud SQL instance (`database_type = "NONE"`), creates no Secret Manager entries,
   and runs no database-initialisation job — Uptime Kuma stores everything in an
   embedded SQLite database that it creates itself on first boot. The platform
   mounts a Filestore (NFS) share at the fixed container path `/app/data` and
   mirrors the official `louislam/uptime-kuma` image into Artifact Registry
   (`enable_image_mirroring = true`). Because there is no database to provision,
   this deploy is dominated by Autopilot node scheduling and the NFS mount rather
   than by Cloud SQL creation — expect it to complete noticeably faster than
   database-backed GKE modules.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep uptimekuma | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Both the startup and liveness probes are a plain
   HTTP `GET /` on port `3001` — Uptime Kuma's native port:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

   The startup probe is deliberately generous (30 s initial delay, 10 s period, 30
   failure threshold — up to several minutes), which covers first-boot SQLite
   schema creation on a fresh NFS volume.

3. Open `http://${EXTERNAL_IP}` in a browser. On first access Uptime Kuma serves its
   **setup wizard** — create the admin account immediately. There is no default or
   auto-generated credential in Secret Manager to retrieve:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   ```

   Until the admin account exists, the setup page is reachable by anyone who finds
   the external IP — do not leave a freshly deployed instance unconfigured for long.

4. Add a first monitor (e.g. an HTTPS check against a site you own) and watch it
   turn green.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the NFS-backed PVC:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Do not scale beyond one replica.** Both `min_instance_count` and
   `max_instance_count` default to `1` and should stay there — Uptime Kuma's
   embedded SQLite database is single-writer, and every pod would otherwise share
   the same NFS-mounted database file. Unlike modules that scale via a Redis-backed
   queue, there is no supported way to run more than one Uptime Kuma replica
   against the same data volume.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Because this module is NFS-backed, the
   Foundation sets the Deployment's update strategy to `Recreate` rather than the
   default `RollingUpdate` — the running pod is fully terminated before the
   replacement starts, rather than surging a second pod that would otherwise write
   the same SQLite file concurrently. Expect a short gap in monitoring coverage
   during the update, not a seamless rolling replace.

4. **Confirm there are no secrets or init jobs to manage** — this module creates
   neither:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   kubectl get jobs -n "$NS"                                             # expect none by default
   ```

5. **Verify the persistent state lives on Filestore (NFS), not ephemeral disk,**
   and back it up:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- ls -la /app/data
   ```

   Export a backup from the Uptime Kuma UI (Settings → Backup) periodically, in
   addition to any Filestore snapshot policy.

   **Known limitation — SQLite over NFS.** Uptime Kuma's embedded SQLite database
   defaults to WAL (write-ahead log) journal mode, which relies on shared
   memory-mapped file locking. NFS does not reliably support that locking model,
   so `SQLITE_CORRUPT` errors can surface **even when the Filestore/NFS mount
   itself is correctly configured** — this is a limitation of running SQLite's WAL
   mode over NFS, not a sign of NFS misconfiguration, and it is not fully resolved
   by keeping the replica count at 1. If you rely on long-term monitor history,
   treat the UI export/backup step above as load-bearing rather than optional. The
   practical workarounds if you hit corruption are to switch Uptime Kuma to
   `DELETE` journal mode (trades some write performance for NFS-safe locking) or
   to restore from the most recent backup / reset the database file and let
   Uptime Kuma recreate its schema (losing monitor history since the last
   backup).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts (a restarting pod is the fastest signal
   that monitoring coverage has gaps). The module can optionally provision a
   Cloud Monitoring **uptime check** against Uptime Kuma's own `GET /` endpoint
   (`uptime_check_config.enabled = false` by default) — an outside-in signal that
   your monitoring system is itself up. This is separate from the monitors you
   configure inside the Uptime Kuma UI.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Uptime Kuma releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe is HTTP `GET /` on port `3001`; a workload that never opens that port
  will fail Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pending pod / NFS not mounting:** confirm the Filestore instance is
  `READY` and the PVC is `Bound` before assuming an application bug:
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  kubectl get pvc -n "$NS"
  kubectl describe pod -n "$NS" <pod>          # look for mount errors in Events
  ```
- **"database is corrupted" / SQLITE_CORRUPT in logs:** see the Task 3 note above
  — this is a known limitation of SQLite's default WAL journal mode running over
  NFS, and can occur independently of whether the NFS mount is correctly
  configured. It is not necessarily fixed by re-checking the Filestore setup.
  Restore from the most recent Uptime Kuma backup, or delete the SQLite file
  under `/app/data` and let Uptime Kuma recreate its schema on next boot
  (monitor history is lost back to the last backup). Switching to `DELETE`
  journal mode inside the container reduces the risk going forward.
- **Monitors show gaps in history:** confirm the pod has not been restarting
  (`kubectl get pods -n "$NS"` restart count) and that only one replica is
  running — `max_instance_count` above `1` risks lock contention on the shared
  SQLite file, which can itself present as gaps or corruption.
- **No external IP:** check `kubectl describe pod` events for resource or quota
  issues, and confirm the LoadBalancer Service has an assigned IP
  (`kubectl get svc -n "$NS"`).
- **Image pull errors:** this module deploys the prebuilt, mirrored
  `louislam/uptime-kuma` image — confirm the mirrored copy exists in Artifact
  Registry and the node service account can pull it; there is no Cloud Build
  step to debug since the image is not custom-built.
- **Update seems to cause downtime:** expected — see the `Recreate` strategy
  note in Task 3.3. This is a deliberate trade-off to avoid two pods writing the
  SQLite file at once, not a stuck rollout.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including why `enable_nfs`, `nfs_mount_path`, and
`max_instance_count` are marked Critical/High risk).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, and the Filestore NFS share (including the SQLite database with all
monitors and history — export a backup first if you want to keep them). There is no
Cloud SQL instance, Secret Manager secret, or GCS bucket to clean up by default.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Filestore
networking, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload with a Filestore NFS mount at `/app/data` and mirrors the prebuilt image — no Cloud SQL, secrets, or init jobs |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the initial admin account on the first-run setup page |
| 3 — Operate | Manual | Inspect workload, keep replica count at 1, update version (Recreate strategy), verify and back up NFS-backed SQLite state |
| 4 — Observe | Manual | Query Cloud Logging; review pod restarts and CPU/memory; optionally monitor the monitor |
| 5 — Troubleshoot | Manual | Diagnose pod, NFS-mount, SQLite-over-NFS corruption, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
