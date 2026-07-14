---
title: "Beszel on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Beszel on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Beszel on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Beszel is a lightweight, open-source server-monitoring hub — historical resource metrics, Docker container stats, and configurable alerts, built on PocketBase with an embedded SQLite database. This lab takes you through the full operational lifecycle of the **Beszel on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Beszel product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running StatefulSet.
- Access and verify the hub, and complete the first-run admin setup.
- Perform day-2 operations — inspect the workload, manage the SQLite PVC, and update the version.
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

1. Click **Deploy** in the RAD platform top navigation, open **Beszel (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform schedules a single-replica **StatefulSet** on the GKE Autopilot
   cluster (one Go container on port 8090), provisions a 20 Gi block **Persistent
   Volume** mounted at `/beszel_data` for the embedded SQLite database, and mirrors
   the Beszel image into Artifact Registry. **No Cloud SQL, no Redis, and no
   init job is created** — Beszel is self-contained, so the deploy is quick
   (typically **10–20 minutes**, no Cloud SQL provisioning to wait on).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep beszel | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and find how the Service is exposed. Beszel defaults
   to `ClusterIP` (internal only), so a LoadBalancer IP or custom domain is only
   present if you enabled one:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: ${EXTERNAL_IP:-<none — ClusterIP only, use port-forward or a custom domain>}"
   ```

2. If no external address is exposed yet, reach the hub with a port-forward:

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" "svc/$SVC" 8090:8090 &
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8090/api/health"   # expect 200
   ```

   Beszel's health path is `/api/health`, a public, unauthenticated endpoint that
   returns HTTP 200 once the hub is ready (first boot creates the SQLite schema,
   so allow up to a minute on a fresh deploy — the startup probe's retry window
   already covers this).

3. Open the hub in a browser (via the external IP/custom domain, or
   `http://localhost:8090` over the port-forward). On first boot Beszel presents
   PocketBase's first-run **superuser (admin) setup** — enter an admin email and
   password to complete it. No admin credential is stored in Secret Manager; the
   account you create here lives in the SQLite database on the PVC.

4. After creating the admin, add a system to monitor: the hub shows the agent
   install command and its public key. Install the Beszel agent on a machine you
   want to watch and confirm it starts reporting to the hub URL. Note that agents
   outside the cluster can only reach the hub if it is exposed externally
   (`service_type` set to `LoadBalancer`, or a custom domain via Ingress) — a bare
   `ClusterIP` only serves other in-cluster workloads.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

2. **Scaling is deliberately pinned.** Beszel runs `min_instance_count = 1` and
   `max_instance_count = 1` — one pod, one SQLite writer. **Do not raise
   `max_instance_count`**: more than one pod against the shared PVC risks lock
   contention and database corruption; a plan-time guard also rejects
   `min_instance_count > max_instance_count`. Any change is a configuration
   change made via **Update** on the deployment details page, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via
   **Update** on the deployment details page; a new image is mirrored and the
   StatefulSet replaces the single pod (only one pod may own the PVC at a time,
   so this is a replace, not a rolling update across two pods). Beszel migrates
   its embedded database automatically on upgrade. Pin an explicit tag rather
   than `latest` to control when that happens.

4. **Inspect the state that matters — the PVC.** The Persistent Volume *is* the
   database (SQLite file, config, metric history):

   ```bash
   kubectl get pvc -n "$NS"
   kubectl describe pvc -n "$NS" <pvc-name>
   gcloud compute disks list --project="$PROJECT" --filter="name~beszel"
   ```

   Treat it as production data: never delete the StatefulSet with its PVC, or
   the underlying disk, while the deployment lives — doing so erases all
   monitoring history and the admin account.

5. **Secrets and jobs** — Beszel injects no application secrets (no encryption
   key, JWT secret, or DB password to manage; the DB is embedded SQLite and the
   admin is created in the UI), and there is no init job:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~beszel"
   kubectl get jobs -n "$NS"          # expect none by default
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
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled) against `/api/health`; review
   Monitoring → Uptime checks and Alerting → Policies. (Meta note: this GCP
   monitoring observes the *hub*; Beszel itself monitors the machines its agents
   run on — the two are not the same thing.)

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Beszel releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/api/health`, with a retry window that covers
  first-boot schema creation:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck Pending / PVC unbound:** check for GKE SSD quota exhaustion
  (`SSD_TOTAL_GB`) or resource scheduling issues:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pod -n "$NS" <pod>          # look for "Quota exceeded" or FailedScheduling events
  ```
- **History gone after a pod restart / redeploy:** confirm the same PVC (not a
  fresh one) reattached, and that the StatefulSet was not scaled beyond 1 or its
  PVC deleted:
  ```bash
  kubectl get pvc -n "$NS"
  gcloud compute disks list --project="$PROJECT" --filter="name~beszel"
  ```
- **Agents can't report:** confirm the Service is actually reachable from
  outside the cluster (`service_type = LoadBalancer` or a custom domain via
  Ingress) — a `ClusterIP` Service only serves in-cluster traffic, so external
  agents will fail to connect. Also confirm IAP is **off** — IAP blocks all
  unauthenticated requests, including agent metric posts from machines that
  cannot present a Google identity.
- **Database locked / intermittent errors:** check the pod count. If
  `max_instance_count` was raised above 1, two writers are fighting over one
  SQLite file on the same PVC — set it back to 1 immediately via **Update**.
- **Image pull errors:** confirm the image exists in Artifact Registry
  (`enable_image_mirroring = true` mirrors the upstream image) and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules never to delete the PVC
and never to raise `max_instance_count` above 1).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the Persistent Volume (which **is** the SQLite database — all
monitoring history and the admin account go with it), and the mirrored Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single-replica StatefulSet (port 8090), a 20 Gi PVC at `/beszel_data`, and mirrors the image — no DB, no Redis, no init job |
| 2 — Access & verify | Manual | `/api/health` returns 200; complete the PocketBase superuser setup and connect an agent |
| 3 — Operate | Manual | Inspect the workload, respect the single-replica pin, update version, inspect the PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/quota, agent-ingress, SQLite-lock, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the PVC |
