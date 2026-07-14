---
title: "Changedetection.io on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Changedetection.io on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Changedetection.io on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Changedetection_GKE)**

## Overview

**Estimated time:** 30–60 minutes

changedetection.io is a self-hosted service that monitors web pages for changes and
sends notifications when they occur. This lab takes you through the full operational
lifecycle of the **changedetection.io on GKE Autopilot** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
changedetection.io product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Changedetection_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Set an initial dashboard password (or front the workload with IAP) since
  changedetection.io ships with no login.
- Perform day-2 operations — inspect the StatefulSet and its PVC, respect the
  single-replica scaling constraint, update the version, and manage secrets/storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
  changedetection.io needs no database, so no Cloud SQL instance is required for this
  module specifically.
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

1. Click **Deploy** in the RAD platform top navigation, open **Changedetection (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Changedetection_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a **StatefulSet**
   with a 20Gi block Persistent Disk mounted at `/datastore` (the default when
   `stateful_pvc_enabled = true`), provisions a GCS data bucket (used for the GCS FUSE
   fallback and backups), builds the container image (pinning `application_version =
   "latest"` to a known-good tag via the `CHANGEDETECTION_VERSION` build arg), and
   exposes it through a Kubernetes Ingress with a reserved static IP and a Google-managed
   certificate. There is no database and no initialization job, so first deploys take
   roughly **15–30 minutes** — faster than most GKE modules, dominated by the image
   build and Autopilot node scheduling rather than Cloud SQL provisioning.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep changedetection | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the StatefulSet's pod is running and find the Ingress external address
   (the Service is `ClusterIP` by default; the Ingress carries the reserved static IP):

   ```bash
   kubectl get pods,statefulset,pvc -n "$NS"
   kubectl get ingress -n "$NS"
   EXTERNAL_IP=$(kubectl get ingress -n "$NS" \
     -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   When no custom domain is configured, the module serves a `nip.io` hostname derived
   from this IP (e.g. `https://<ip>.nip.io`) so HTTPS works without owning a domain.
   The Google-managed certificate can take up to an hour to finish provisioning on a
   fresh deploy — an ingress that 404s or times out immediately after apply is often
   still waiting on the certificate, not a broken deploy.

2. Confirm the dashboard responds:

   ```bash
   curl -sk -o /dev/null -w "%{http_code}\n" "https://${EXTERNAL_IP}.nip.io/"
   # expect 200 — the changedetection.io dashboard (startup/liveness probes target the same path)
   ```

3. Open the URL in a browser. changedetection.io ships with **no login by default** —
   the dashboard is immediately accessible to anyone who reaches the Ingress. Go to
   **Settings → General → Password** and set a password right away, and/or enable IAP
   (Group 20 — `enable_iap`) so Google sign-in gates access before the dashboard loads.
   There is no pre-seeded admin credential in Secret Manager to look up.

4. Set `BASE_URL` now that the external address is known, so notification bodies
   contain working links (the GKE wrapper does not inject this automatically):

   ```bash
   kubectl set env -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     BASE_URL="https://${EXTERNAL_IP}.nip.io"
   ```

   Or set `environment_variables = { BASE_URL = "https://..." }` in the module config
   and apply via **Update** so the value survives the next rollout.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, PVC, and pod disruption budget:

   ```bash
   kubectl get statefulset,pods,pvc,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl describe pvc -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and `max_instance_count`
   both default to `1` and should stay there — the fetch scheduler runs in-process
   against a single file-based datastore, and a second replica writing the same
   `/datastore` volume risks corrupting `url-watches.json`. There is no HPA to manage
   here; the only supported "scaling" action is vertical (`cpu_limit`/`memory_limit`)
   via **Update** on the deployment details page.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds (re-pinning `latest` to the
   current known-good tag if left as `latest`) and the StatefulSet rolls the single pod.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~changedetection"
   gcloud storage buckets list --project="$PROJECT" --filter="name~changedetection"
   kubectl get cronjob -n "$NS"     # backup_schedule, if any backup jobs are configured
   ```

   changedetection.io has no application secret of its own — the optional REST API
   token is generated inside the web UI (**Settings → API**), not injected via env var
   or Secret Manager. There is also no database to connect to; every state (watches,
   snapshots, diff history, the UI password) lives on the `/datastore` volume — never
   delete or recreate the PVC (or the GCS bucket, if running with `stateful_pvc_enabled
   = false`) without a backup, since doing so wipes all monitoring history permanently.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and PVC usage. The module can provision an **uptime
   check** (when `uptime_check_config` is set); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with changedetection.io releases.

- **Pod not Ready / CrashLoopBackOff:** the startup and liveness probes target `/` —
  the web UI. First boot is fast (no migrations, no database to wait on), so a pod
  stuck Pending or repeatedly restarting is more often a scheduling, PVC-binding, or
  image-pull problem than an application startup delay.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC stuck Pending / pod stuck Pending:** check the PVC's `StorageClass`
  (`standard-rwo` by default) against regional SSD quota — GKE block PVCs draw the
  `SSD_TOTAL_GB` quota, which can be tight on quota-constrained projects.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **Ingress has no external IP, or HTTPS doesn't work yet:** confirm the static IP was
  reserved and the managed certificate has finished provisioning — this can take up to
  an hour after first deploy and is a normal, transient state, not a failure.
  ```bash
  kubectl describe ingress -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Watch data not persisting across pod restarts:** confirm the PVC is actually bound
  and mounted at `/datastore` (or, on the GCS FUSE fallback, that the bucket exists and
  is mounted) — a mismatched mount path silently falls back to ephemeral pod disk.
- **Notification links are broken (point at `localhost` or nothing):** `BASE_URL` is
  not injected automatically on GKE; set it as shown in Task 2 step 4.
- **Dashboard reachable by anyone:** there is no login by default — set a password
  under **Settings → General** or enable IAP (Group 20); this is expected behaviour,
  not a bug, until you configure one of the two.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `max_instance_count = 1` and never delete
the datastore PVC/bucket).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace (StatefulSet, PVC, and Ingress), Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet + block PVC, GCS data bucket, Ingress with static IP/managed cert, and builds the image — no database, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; set a dashboard password (or IAP) and `BASE_URL` |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep single-replica scaling, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, ingress/certificate, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
