---
title: "Gokapi on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Gokapi on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gokapi on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Gokapi is a lightweight, self-hosted file-sharing server written in Go — a
self-hosted alternative to WeTransfer, generating shareable download links with
optional expiry, download-count limits, and password protection. This lab takes
you through the full operational lifecycle of the **Gokapi on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Gokapi product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, and claim the
  administrator account.
- Perform day-2 operations — inspect the workload, scale correctly, update the
  version, and manage the optional API key and PVC storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Gokapi (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys Gokapi into the GKE Autopilot cluster as a single-pod
   **StatefulSet** with a 20Gi block Persistent Volume Claim mounted at `/data` —
   this PVC is Gokapi's persistence for both its internal SQLite database and
   every uploaded file (there is no Cloud SQL instance; `database_type` is fixed
   to `NONE`). A Kubernetes Gateway with a reserved static external IP is
   provisioned by default (`enable_custom_domain = true`, `reserve_static_ip =
   true`), giving Gokapi a public endpoint out of the box. No
   database-initialisation job runs — Gokapi manages its own storage. Because
   there is no Cloud SQL instance to provision, first deploys are considerably
   faster than database-backed modules — typically **10–20 minutes**, dominated
   by node provisioning, the image build, and Gateway propagation.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gokapi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,statefulset,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its public address. Because
   `service_type` defaults to `ClusterIP`, the public entry point is the
   Gateway/HTTPRoute, not the Kubernetes Service directly:

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   kubectl get gateway,httproute -n "$NS"
   gcloud compute addresses list --project="$PROJECT"   # the reserved static IP
   ```

   The default hostname is `<reserved-ip>.nip.io` unless a custom domain was
   configured via `application_domains`.

2. Confirm the service is up. Gokapi's health probes hit the public root, so a
   plain `curl` is a sufficient liveness check (no API endpoint or auth required):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://<reserved-ip>.nip.io/"   # expect 200
   ```

3. Open `http://<reserved-ip>.nip.io` in a browser **immediately**. Gokapi has no
   pre-seeded admin credential — on first visit it serves its own first-run setup
   wizard, and whoever reaches it first claims the administrator account. Because
   the Gateway is public by default, don't leave this step for later.

4. Confirm data is actually landing on the PVC once you've used the UI to
   upload a file:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /data/config /data/data
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one pod.** `min_instance_count = 1` /
   `max_instance_count = 1` is a hard operational limit, not a tunable default —
   Gokapi's SQLite database is single-writer with no clustering or replication
   story, so raising `max_instance_count` risks database corruption and
   inconsistent uploads. There is nothing to configure here; leave both at 1.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Gokapi's Dockerfile resolves the
   platform's `latest` default to a pinned, known-good tag (`v1.9.6`) via an
   app-specific build argument, so leaving the version at `latest` is safe and
   reproducible; pin explicitly if you need a different release. A new image
   builds and the StatefulSet's single pod is replaced.

4. **Manage the optional operator API key and PVC-backed storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"
   kubectl get pvc -n "$NS"
   ```

   The API key (only present if `enable_api_key = true` was set at deploy time)
   is a convenience only — Gokapi's real upload/download API keys are normally
   minted from the admin UI after setup. It's injected as a native Kubernetes
   Secret and exposed via the `gokapi_api_key_secret_id` module output.

5. **Inspect the PVC contents directly** for a snapshot of persisted state
   (there is no database session to open — Gokapi has no Cloud SQL instance):

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /data/config /data/data
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
   memory utilisation (Gokapi is a lightweight Go binary, so expect low
   steady-state usage), restart counts, and PVC disk usage. The module can
   provision an **uptime check** (disabled by default); review Monitoring →
   Uptime checks and Alerting → Policies if enabled.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gokapi releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the
  startup and liveness probes target `/` (unauthenticated, no dependency on an
  external database), so a failure here usually points at the PVC mount or
  scheduling rather than the app itself.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC stuck `Pending` / `Quota 'SSD_TOTAL_GB' exceeded`:** the default
  `stateful_pvc_storage_class = "standard-rwo"` is SSD-backed and draws the
  (often tight) regional SSD quota. Gokapi's I/O pattern does not need SSD-level
  IOPS — override to HDD with `-var stateful_pvc_storage_class=standard` if
  quota is scarce.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **No external IP / Gateway not reachable:** confirm `enable_custom_domain` and
  `reserve_static_ip` are both `true`, and that a static IP was actually
  reserved:
  ```bash
  kubectl get gateway,httproute -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Someone else claimed the administrator account first:** because the
  first-run setup wizard is public and unauthenticated by default, there is no
  built-in recovery — plan to claim it immediately after the workload becomes
  reachable.
- **Optional API key secret not found:** confirm `enable_api_key` was set to
  `true` at deploy time — it defaults to `false` and no secret is created
  otherwise.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including why `max_instance_count` and
`stateful_pvc_mount_path` must be left at their defaults).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes
StatefulSet, namespace, the PVC (and with it the SQLite database and every
uploaded file — there is no separate backup of this data by default), the
optional API key secret, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, Artifact Registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single-pod StatefulSet with a 20Gi PVC, a public Gateway with a reserved static IP, and builds the pinned Gokapi image |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; claim the first-run admin account immediately (public by default) |
| 3 — Operate | Manual | Inspect workload, keep scaling at 1, update version, manage optional API key/PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/SSD-quota, Gateway, admin-claim race, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the SQLite DB and uploads |
