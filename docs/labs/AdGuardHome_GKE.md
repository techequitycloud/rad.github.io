---
title: "AdGuardHome on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy AdGuardHome on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# AdGuardHome on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE)**

> ⚠️ **CRITICAL — this module does not serve DNS.** AdGuard Home's core value
> (network-wide DNS ad/tracker blocking) requires clients to query it on port
> 53 (TCP+UDP), which this module's standard HTTP(S) Gateway pattern cannot
> expose. This lab deploys and verifies AdGuard Home's **web admin console
> only** — do not expect it to act as a working DNS resolver for real clients.

## Overview

**Estimated time:** 45–60 minutes

AdGuard Home is an open-source, network-wide DNS ad- and tracker-blocking
server with a web admin console for managing filter lists, custom rules, and
per-client settings. This lab takes you through the full operational
lifecycle of the **AdGuard Home on GKE Autopilot** module — deploying its web
admin console, verifying it, running it day-to-day, observing it, diagnosing
common problems, and tearing it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on AdGuard Home's DNS-filtering features (which are not reachable in this
deployment shape). For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running admin console (and understand what it cannot do — serve real DNS).
- Perform day-2 operations — inspect, scale, update, and manage storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
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

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **AdGuard Home
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions two Cloud Storage buckets (`conf` and `work`, mounted via GCS
   Fuse CSI), and builds the custom container image. There is no database and
   no init job, so this deploy is faster than most modules in this
   catalogue — typically **5–10 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep adguardhome | head -1 | cut -d/ -f2)
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
   echo "External IP: $EXTERNAL_IP   (web admin console ONLY — not a DNS resolver)"
   ```

2. Confirm the service responds:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit, AdGuard Home
   serves its own **setup wizard** (not a RAD-managed login) on port 3000:
   choose the admin web UI port (**keep it 3000** — see the Pitfalls note
   below), set the admin username and password, and select upstream DNS
   servers. Complete the wizard to reach the dashboard.

4. Confirm the setup persisted by refreshing the page — you should land on
   the login page (not the setup wizard again), proving the configuration was
   written to the persistent `conf` GCS volume rather than lost on a pod
   restart.

5. **Remember:** this deployment's DNS server function is not reachable —
   only the web admin console you just configured is. Do not configure real
   devices to use this service's IP as their DNS server.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply).

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds and a
   rolling update replaces the pod.

4. **Inspect storage:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~adguardhome"
   kubectl describe pod -n "$NS" -l app=adguardhome | grep -A5 Mounts
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Look for the entrypoint's DNS-scope reminder banner near the start of a
   fresh pod's logs. Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation and restart counts. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stops becoming Ready after you changed the web UI port in the setup
  wizard:** this is the module's #1 known pitfall — the platform's health
  probe and public URL are fixed at `container_port` (3000). If you changed
  AdGuard Home's own web UI port away from 3000 during setup, revert it (edit
  `AdGuardHome.yaml` on the `conf` bucket, or re-run setup) or set
  `container_port` to match.
- **Configuration not persisting across pod restarts:** confirm the `conf`
  and `work` GCS buckets exist and are mounted (`kubectl describe pod` →
  Mounts section) — check `gcs_volumes` was not overridden to something that
  omits them.
- **"Is this actually blocking ads on my network?"** No — this deployment's
  DNS server is not reachable from outside the cluster's Service (which only
  forwards the admin console's HTTP port). This is expected; see the CRITICAL
  note at the top of this guide.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, GCS buckets (`conf`, `work`), and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, two GCS buckets (`conf`, `work`), and builds the container image |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete AdGuard Home's own setup wizard; confirm config persists |
| 3 — Operate | Manual | Inspect workload, scale, update version, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, port-mismatch, storage, and scheduling issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
