---
title: "Gatus on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Gatus on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gatus on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Gatus is an open-source, developer-oriented status page and health-check monitor:
it polls configured HTTP, TCP, DNS, and other endpoints on independent schedules,
evaluates simple pass/fail conditions, and serves a live public status page plus
alerting — no external database required. This lab takes you through the full
operational lifecycle of the **Gatus on GKE Autopilot** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Gatus product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including viewing the
  live status page.
- Perform day-2 operations — inspect, scale considerations, update, and manage
  secrets and durable history storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Gatus (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs. If you also plan to deploy `Gatus_CloudRun` on the
   same tenant, set `tenant_deployment_id = "gke"` here (and `"cr"` on the Cloud Run
   variant) to avoid a naming collision on shared secret names, GCS bucket names,
   and rotation topics.

2. The platform deploys a single Deployment workload into the GKE Autopilot
   cluster running the Gatus Go binary, and builds the container image (which bakes
   in a default `config.yaml` with one example HTTP check). No database, cache, or
   object-storage bucket is provisioned — Gatus's optional history store is a local
   SQLite file. There is no database-initialisation job to wait for, so a first
   deploy is typically much faster than a database-backed module (roughly
   **10–15 minutes**, dominated by the image build and workload scheduling).

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gatus | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Gatus's health endpoint responds as soon as the
   server binds its port — there is no database dependency to wait on:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}/` in a browser to view the live status page — it
   shows the baked-in `example` endpoint check and its up/down history as checks
   accumulate.

4. Gatus ships with **no authentication** on its status page by default — anyone
   with the external IP can view it. There is no admin account to create. If the
   page will list sensitive endpoint names, edit
   `modules/Gatus_Common/scripts/config.yaml`'s `security` block (basic auth or
   OIDC) and redeploy — this requires a rebuild, not a runtime setting.

5. Gatus has **no runtime API or UI for adding monitored endpoints**. To monitor a
   real endpoint instead of (or alongside) the baked-in example, edit the
   `endpoints` list in `modules/Gatus_Common/scripts/config.yaml` and redeploy.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Do not scale beyond one replica.** `max_instance_count` defaults to `1` and
   should stay there — Gatus's watchdog polling loop has no shared coordination
   between replicas, so scaling out would have each replica independently poll
   every endpoint and duplicate alert notifications. Any change to min/max
   instances is made via the RAD platform's deployment details page and applied via
   **Update**, not a manual `kubectl scale` (which would be reverted on the next
   apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pod. Pin an explicit `v5.x.y` in production rather than relying on
   `latest`.

4. **Manage secrets:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gatus"
   ```

   Gatus generates no secrets of its own at deploy time — the Secret Manager list is
   only populated if you supplied entries via `secret_environment_variables`.

5. **Enable durable check history**, if the default ephemeral store is not
   acceptable. Set `stateful_pvc_enabled = true` (which auto-selects
   `workload_type = "StatefulSet"`) with `stateful_pvc_mount_path = "/data"` and
   `stateful_pvc_storage_class = "standard"` (HDD) — this is the **only** option in
   this catalogue verified safe for Gatus's history store, since Gatus hardcodes
   SQLite WAL journal mode and SQLite's own documentation states WAL is unsupported
   on network filesystems (which rules out `enable_nfs` as a safe alternative).

   ```bash
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Gatus logs each endpoint check's result (success/failure, duration) as it runs —
   useful for confirming a newly-added endpoint is actually being polled.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gatus releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes both target `/health`, which should return `200` within seconds
  of boot — Gatus has no database to wait on, so a slow or failing probe usually
  points at a container build or config issue rather than a downstream dependency.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Check history "disappears" after a pod restart:** this is expected with the
  default stateless Deployment and ephemeral storage — a pod restart resets history
  by design (the configured endpoints themselves are unaffected, only their
  historical results/uptime percentages reset). If a PVC is enabled, confirm
  `stateful_pvc_mount_path` matches Gatus's baked-in `storage.path` directory
  (`/data`) exactly:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl exec -n "$NS" <pod> -- ls -l /data
  ```
- **A newly-added endpoint isn't being checked:** confirm you edited
  `modules/Gatus_Common/scripts/config.yaml` and redeployed — Gatus has no runtime
  API for adding checks, so an endpoint added anywhere else has no effect.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP:
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Status page unreachable / blocked unexpectedly:** check whether `enable_iap`
  was turned on — IAP requires Google sign-in and blocks unauthenticated viewing,
  which is usually not what a public status page wants.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including keeping `max_instance_count = 1`, matching
the PVC mount path to `/data`, and the SQLite WAL persistence caveat).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, any PVC, and Artifact Registry images. There is no Cloud SQL
database, GCS bucket, or auto-generated secret to clean up (Gatus provisions none by
default). Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single GKE workload running Gatus; no database or storage bucket |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; live status page renders with the baked-in example check |
| 3 — Operate | Manual | Inspect workload, keep max instances at 1, update version, manage secrets, enable a block PVC for durable history |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, config-edit, history-persistence, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
