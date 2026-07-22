---
title: "TechnitiumDNS on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy TechnitiumDNS on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# TechnitiumDNS on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE)**

## Overview

**Estimated time:** 45–90 minutes

> ⚠️ **Before you start:** this module deploys Technitium's **web admin console + REST API only**
> (port 5380/HTTP). Technitium's core DNS resolver function (port 53/udp+tcp) **cannot** be exposed
> through this module's standard HTTP(S) Gateway pattern. This lab covers managing DNS zones/records via
> the console — it does NOT make this deployment usable as an actual DNS resolver from any client.

Technitium DNS Server is an open-source, self-hosted authoritative/recursive DNS server with a
full-featured web console for managing zones, records, DNS-based blocking, and forwarders — no external
database required. This lab takes you through the full operational lifecycle of the **TechnitiumDNS on
GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on TechnitiumDNS's
DNS-server product features. For the complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including a first login and a
  zone-creation smoke test.
- Perform day-2 operations — inspect, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster, Artifact
  Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **TechnitiumDNS (GKE)** from the
   **Platform Modules** list to start configuration, set `project_id`, and review the inputs. Configure
   only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE) documents every
   input by group, with defaults. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs. If deploying alongside
   `TechnitiumDNS_CloudRun` on the same tenant, set a distinct `tenant_deployment_id` (e.g. `"gke"`) to
   avoid a naming collision.

2. The platform deploys a single Deployment workload into the GKE Autopilot cluster running the official
   prebuilt `technitium/dns-server` image, plus one Cloud Storage bucket (mounted at `/etc/dns`) and one
   auto-generated admin-password secret. No database is provisioned. Since the image is prebuilt (no
   Cloud Build step) and there is no database-initialisation job to wait for, a first deploy is
   typically fast (roughly **8–15 minutes**, dominated by workload scheduling).

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep technitiumdns | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy — the console root page responds as soon as the server binds its
   port, with no database dependency to wait on:

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://${EXTERNAL_IP}/"
   # expect 200 and a large body
   ```

3. Retrieve the auto-generated admin password:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}/` in a browser and log in as `admin` with that password. **Immediately
   change the password from the console's own user-management page** — Technitium only reads
   `DNS_SERVER_ADMIN_PASSWORD` on the very first boot.

5. Run a zone-creation smoke test: in **Zones → Add Zone**, create a simple primary zone
   (e.g. `example.test`), add an `A` record, save, then delete the pod (`kubectl delete pod <pod> -n
   "$NS"`) to force a reschedule, and confirm the zone and record are still present once the new pod is
   Ready — proving the persisted `/etc/dns` volume genuinely survives a pod restart.

6. Remember: **no client anywhere can resolve DNS queries against this deployment.** The console lets
   you fully manage zone data, but only the web console/API is reachable — not port 53.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Update the application version** by changing the version input in the RAD platform and applying it
   via **Update**; a rolling update replaces the pod with the newly-tagged prebuilt image. Pin an
   explicit version in production rather than relying on `latest`.

3. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~technitiumdns"
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

   Only the auto-generated `DNS_SERVER_ADMIN_PASSWORD` appears in Secret Manager by default.

4. **Switch to a block PVC** for stronger write-locking guarantees, if desired: set
   `stateful_pvc_enabled = true` (with `stateful_pvc_mount_path = "/etc/dns"`, or leave `workload_type`
   unset to auto-select `StatefulSet`) and apply via **Update**. The module automatically disables the
   GCS FUSE volume in that case to avoid a double-mount.

5. **Enable Identity-Aware Proxy** for a production deployment — set `enable_iap = true` with authorized
   users/groups (and the required OAuth client ID/secret) and apply via **Update**.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter: `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory utilisation,
   restart counts, and request metrics. If a Cloud Monitoring **uptime check** is enabled, review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with TechnitiumDNS releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and liveness probes both
  target `/`, which should return `200` within seconds of boot — TechnitiumDNS has no database to wait
  on, so a slow or failing probe usually points at a container or storage-mount issue rather than a
  downstream dependency.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **"I can't resolve DNS against this deployment":** this is expected — see the disclosure at the top of
  this guide. This module intentionally exposes only the web console/API, never port 53.
- **Zones/records disappear after a pod restart:** confirm the config Cloud Storage bucket or PVC is
  actually mounted:
  ```bash
  kubectl exec -n "$NS" <pod> -- ls -l /etc/dns
  kubectl get pvc -n "$NS"    # if stateful_pvc_enabled = true
  ```
- **Can't log in with the Secret Manager password:** remember it only applies on the very first boot. If
  the console was ever started before with the same persisted volume, the password already on disk
  wins — use the console's own password-reset flow.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or quota issues, and
  confirm the LoadBalancer Service has an assigned IP:
  ```bash
  kubectl get svc -n "$NS"
  ```
- **A stateful_pvc_enabled switch left both a GCS volume AND a PVC:** confirm only one is mounted at
  `/etc/dns` — the module should automatically disable the GCS volume when the PVC is enabled; if both
  somehow appear, redeploy after clearing state.
- **Image pull errors:** confirm the image exists in Artifact Registry (if mirrored) and the node service
  account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for setting-specific
gotchas (including the no-DNS-resolver scoping decision and the PVC mount-path requirement).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs
`terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment
is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict
with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This removes everything the
module created — the Kubernetes workload and namespace, any PVC, the config Cloud Storage bucket, the
admin-password secret, and Artifact Registry images. There is no Cloud SQL database to clean up
(TechnitiumDNS provisions none). Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single GKE workload running the prebuilt TechnitiumDNS image, one config bucket, one secret |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; first login succeeds; a zone/record survives a pod restart |
| 3 — Operate | Manual | Inspect workload, update version, manage secrets/storage, optionally switch to a block PVC, enable IAP |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, storage-persistence, scheduling, and image-pull issues; confirm no-DNS-resolver scoping |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
