---
title: "Headscale on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Headscale on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Headscale on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_GKE)**

## Overview

**Estimated time:** 30–45 minutes

Headscale is an open-source, self-hosted implementation of the Tailscale
coordination server — the control plane for a private WireGuard mesh VPN,
compatible with the official Tailscale clients. This lab takes you through
the full operational lifecycle of the **Headscale on GKE Autopilot** module
on Google Cloud: deploy it, access and verify it, register your first
client, run it day-to-day, observe it, diagnose common problems, and tear it
down. Unlike most modules in this catalog, there is **no external database
setup** to wait on — Headscale is entirely self-contained around an embedded
SQLite file, backed here by a real block-storage PVC.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Tailscale/WireGuard networking concepts. For the complete
list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including its real `/health` endpoint.
- Create the first Headscale user and a pre-auth key via `kubectl exec`, and register a real Tailscale client against the server.
- Perform day-2 operations — inspect the StatefulSet and PVC, understand why horizontal scaling doesn't apply, and update the version.
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
- *(Optional, for Task 2)* the [Tailscale client](https://tailscale.com/download)
  installed on a device you can use to test a real registration.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Headscale
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_GKE)
   documents every input by group, with defaults. Leave `stateful_pvc_enabled
   = true` (the default) — it's what gives Headscale's SQLite database real
   file-locking support. Review the estimated cost (if credits are enabled)
   and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform builds the custom Headscale image (a `ko`-built upstream base
   with a baked config layered in), provisions the GKE StatefulSet with its
   per-pod block-storage PVC (mounted at `/var/lib/headscale`), a reserved
   static IP, and a Gateway API Ingress for a custom hostname. There is **no
   Cloud SQL instance and no database-initialization job** to wait on —
   SQLite creates itself on first boot — so first deploys typically complete
   in roughly **10–20 minutes** (cluster/Gateway provisioning dominates).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep headscale | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Headscale exposes a real, unauthenticated
   health endpoint:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Check the boot logs for the confirmation sequence a healthy first boot
   produces:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl logs -n "$NS" "$POD" --tail=50
   # Look for lines resembling:
   #   ...generating new private key...
   #   ...database opened successfully...
   #   ...listening and serving HTTP...
   ```

4. **Create the first user and a pre-auth key** by exec'ing directly into the
   running pod — GKE's shell access makes this straightforward:

   ```bash
   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale users create myuser

   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale preauthkeys create \
     --user myuser --reusable --expiration 1h
   ```

   Copy the printed pre-auth key.

5. **Register a real Tailscale client** (optional, requires the Tailscale
   client installed):

   ```bash
   tailscale up --login-server="http://${EXTERNAL_IP}" --authkey=<preauthkey-from-step-4>
   # or, if a custom domain is configured:
   # tailscale up --login-server="https://<your-domain>" --authkey=<preauthkey>
   ```

   The device should connect and appear in Headscale's node registry.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and the PVC backing SQLite:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scaling does not apply the way it does for other modules.**
   `max_instance_count` is hard-pinned to `1` inside `Headscale_Common` —
   changing the `max_instance_count` input in the RAD platform has **no
   effect**; Headscale has no active-active support and two writers against
   the same SQLite file would corrupt it. `min_instance_count = 0` (the
   default) enables scale-to-zero.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying via **Update**; a new image builds
   from the pinned upstream `headscale/headscale:<version>-debug` base and a
   rolling update replaces the pod.

4. **Inspect the storage class and PVC size** (relevant if you ever hit a
   quota limit elsewhere in this project — Headscale's PVC defaults to HDD
   `pd-standard`, drawing from the larger `DISKS_TOTAL_GB` quota, not the
   tight `SSD_TOTAL_GB` quota some other stateful modules in this catalog
   compete for):

   ```bash
   kubectl get pvc -n "$NS" -o wide
   ```

5. **List registered nodes:**

   ```bash
   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale nodes list
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation and restart counts (should stay stable — Headscale
   is lightweight). The module can provision an **uptime check** on
   `/health` (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Headscale releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. A config
  validation failure is the most common cause — Headscale 0.26.1 fails hard
  on a missing `noise.private_key_path` or an incomplete `dns:` block; both
  are already handled correctly in the shipped `config.yaml`.
  ```bash
  kubectl describe pod -n "$NS" "$POD"          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" "$POD" --previous       # logs from the crashed container
  ```
- **PVC-related errors:** unlike the Cloud Run variant, this module uses a
  real block PVC by default (`stateful_pvc_enabled = true`), so you should
  **not** see gcsfuse write errors (`BufferedWriteHandler.OutOfOrderError`)
  here — if you do, check whether `stateful_pvc_enabled` was overridden to
  `false` for this deployment (falling back to the GCS-Fuse mount, and
  reintroducing the same risk documented for `Headscale_CloudRun`).
- **Tailscale client can't register / `tailscale up` fails:** confirm
  `enable_iap = false` (IAP requires a Google identity, which the
  `tailscale` CLI cannot present) and that the external IP/custom domain is
  actually reachable:
  ```bash
  kubectl get gateway,httproute -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the reserved static IP and Gateway
  have both provisioned successfully.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Pitfalls* section for setting-specific
gotchas, including the critical rule that `server_url` should not change
after clients have registered, and that `stateful_pvc_enabled` should stay
`true`.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes StatefulSet, namespace, and PVC (and with it, the entire node
registry and Noise private key — every previously-registered client would
need to re-register against a fresh deployment), the reserved static IP, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared registry) are managed separately and are not removed here.
Recall the catalog-wide rule: scaling the workload to zero replicas does
**not** release the PVC — only deleting the deployment (or the PVC/namespace
directly) does.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and provisions the StatefulSet + block PVC, reserved static IP, and Gateway; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; `/health` returns 200; create the first user + pre-auth key via `kubectl exec`; register a real Tailscale client |
| 3 — Operate | Manual | Inspect StatefulSet/PVC; understand why `max_instance_count` has no effect; update version; list nodes |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, client-registration, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the node registry |
