---
title: "PhotoPrism on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy PhotoPrism on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PhotoPrism on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE)**

## Overview

**Estimated time:** 45–90 minutes

PhotoPrism is a self-hosted, AI-powered photo and video management application —
it browses, organizes, and shares a personal media library with automatic tagging,
facial recognition, and full-text/visual search, all served from a single Go binary
with an embedded SQLite database. This lab takes you through the full operational
lifecycle of the **PhotoPrism on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on PhotoPrism product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running StatefulSet, including its block
  Persistent Volume Claim.
- Perform day-2 operations — inspect, manage secrets, and back up the media library.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
  PhotoPrism itself provisions no Cloud SQL instance — it uses an embedded SQLite
  database on a block PVC.
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

1. Click **Deploy** in the RAD platform top navigation, open **PhotoPrism (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE)
   documents every input by group, with defaults. Note that `stateful_pvc_storage_class`
   defaults to SSD-backed `standard-rwo`, which draws the tight `SSD_TOTAL_GB` quota —
   consider `standard` (HDD) if you are running this alongside other stateful modules
   on a quota-constrained project. Review the estimated cost (if credits are enabled)
   and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys PhotoPrism into the GKE Autopilot cluster as a
   **StatefulSet** (pinned to exactly one replica, `min=1`, `max=1`) with a 20Gi block
   Persistent Volume Claim mounted at `/photoprism`, provisions the auto-generated
   `PHOTOPRISM_ADMIN_PASSWORD` Secret Manager secret, and builds and mirrors the
   container image. A `storage` Cloud Storage bucket is also created but is not
   mounted — the block PVC is the durable store here, not gcsfuse. There is no
   database-init job to wait on — PhotoPrism creates its own SQLite schema on first
   boot. First deploys typically complete in **10–20 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep photoprism | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   By default the Service is `ClusterIP` (not `LoadBalancer`); if `EXTERNAL_IP` is
   empty, check whether a custom domain / Gateway route was configured instead
   (`enable_custom_domain = true` by default) and use `kubectl get gateway,httproute -n "$NS"`.

2. Confirm the service is healthy. PhotoPrism exposes an unauthenticated status
   endpoint that responds once the HTTP server is up and the SQLite index is ready:

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/v1/status"   # expect a 200 JSON response
   ```

3. Retrieve the auto-generated admin password before logging in — no pre-seeded
   credential is shown anywhere else:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~photoprism-admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` (or your custom domain) in a browser and sign in with
   username `admin` (or your configured `admin_username`) and the password retrieved
   above. Once you know the external URL, consider setting `site_url` to it in the
   RAD platform and applying via **Update** — this fixes absolute links and
   thumbnail URLs that otherwise fall back to the request host.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and the block PVC (there is no HPA to
   inspect; PhotoPrism is pinned to one replica):

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and `max_instance_count`
   are both fixed at `1` by design — PhotoPrism serves one shared SQLite library from
   one writable block PVC, and a second concurrent writer risks database and index
   corruption. This is not a scaling dial to tune.

3. **Tune resources for your library size.** `cpu_limit`/`memory_limit` default to
   `1000m`/`1Gi`, but PhotoPrism loads vector indexes into memory for face recognition
   and thumbnailing, and the application layer's own baseline recommendation is `4Gi`
   for real indexing workloads. If you see pod restarts from OOM in `kubectl describe
   pod` events (Task 4) as your library grows, raise `memory_limit` in the RAD
   platform and apply via **Update**. Also confirm `stateful_fs_group = 3000` remains
   set — a mismatched or missing `fsGroup` leaves the PVC non-writable by PhotoPrism's
   UID 1000/GID 2000 and blocks startup.

4. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (pinned to a
   `PHOTOPRISM_VERSION` build tag, not the generic version input, when left at
   `latest`) and the StatefulSet's pod is replaced.

5. **Manage secrets and the PVC:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~photoprism"
   gcloud compute disks list --project="$PROJECT" --filter="name~$NS"
   ```

6. **Back up the media library.** Because PhotoPrism has no SQL database, a backup is
   a filesystem archive of the PVC contents (`backup_format = tar` by default), not a
   database dump. Review `backup_schedule` and `backup_retention_days` in the RAD
   platform, and raise retention for production libraries.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts — watch memory closely as your library
   grows, since indexing and thumbnailing are memory-hungry, and also watch the PVC's
   disk utilisation against its `20Gi` default size. The module can provision an
   **uptime check** (disabled by default); enable it under `uptime_check_config` and
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with PhotoPrism releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup/liveness
  probes both target `/api/v1/status` (no auth required); a PVC mount or
  `fsGroup` mismatch will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck Pending with `Quota 'SSD_TOTAL_GB' exceeded`:** the default
  `standard-rwo` StorageClass draws the tight regional SSD quota; override to HDD
  with `-var stateful_pvc_storage_class=standard` on quota-constrained projects.
  Scaling the pod to zero does not free the PVC — only deleting it reclaims quota.
- **Container OOM-killed:** check pod restart count and events; if memory is pinned
  near the `memory_limit` ceiling, raise it (see Task 3) — 1Gi is the module default
  but under-sized for real libraries.
- **Locked out of the admin account:** re-read the password from Secret Manager
  (Task 2); it is the source of truth and PhotoPrism re-applies it at every boot.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the Service/Gateway has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `max_instance_count` must never be raised above 1, and why
disabling `stateful_pvc_enabled` falls back to gcsfuse, which cannot safely host
SQLite).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the block Persistent Disk (including the embedded SQLite database and
all originals it contains), the unused `storage` GCS bucket, and Secret Manager
secrets. Resources owned by **Services_GCP** (the VPC, GKE cluster, Artifact
Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a single-replica StatefulSet with a 20Gi block PVC and the admin-password secret — no database init to wait on |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve the auto-generated admin password and sign in |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC (never scale beyond 1), tune resources for library size, update version, manage secrets and backups |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics, especially memory and PVC utilisation, and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, SSD-quota, OOM, admin-credential, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the block PVC and its data |
