---
title: "Emby on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Emby on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Emby on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Emby_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Emby is a self-hosted media server for streaming your own movies, TV shows,
music, and photos to any device. Core playback and the setup wizard are free —
no license key or emby.media account required — while Emby Premiere (a separate,
optional paid tier) gates hardware transcoding, the full mobile/TV apps,
DVR/live-TV, and offline sync. This lab takes you through the full operational
lifecycle of the **Emby on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Emby product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Emby_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Complete the Emby first-run setup wizard and add a media library on the PVC.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Emby (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Emby_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** with a block **PersistentVolumeClaim** mounted at `/config`
   (`stateful_pvc_enabled = true` auto-resolves the workload to a StatefulSet and
   sets `enable_gcs_storage_volume` to false). The PVC holds Emby's
   configuration, internal SQLite databases, metadata, plugins, and transcode cache.
   The platform builds the container image (`emby/embyserver`, pinned to `4.10.0.15`
   when `application_version = "latest"`). Emby needs **no external database** —
   it uses an embedded SQLite store under `/config`, so there is no Cloud SQL
   instance and no database-initialisation job. The Service defaults to
   `LoadBalancer` (Emby is a browser/client-facing app). First deploys take
   roughly **8–15 minutes** (image build dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep emby | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running, its PVC is bound, and find its external address:

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is up. Unlike Jellyfin, Emby has **no confirmed,
   documented unauthenticated HTTP health endpoint** on port 8096 (`/health`
   404s live) — the module's own startup/liveness probes are TCP checks against
   the port for this reason. A quick manual proof that the server is really
   listening and serving:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 302 (redirect to /web)
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Emby serves its web UI at `/web`
   (and at `/`). On first visit you are taken straight into the **setup wizard** —
   there are **no default credentials**; the administrator account is created during
   the wizard (Task 3).

---

## Task 3 — Worked example: complete the wizard and add a media library [Manual]

This is the core Emby workflow. You will finish first-run setup, create the
initial admin, add a media library backed by the persistent `/config` PVC, and
confirm you can browse it.

1. **Complete the setup wizard.** With `http://${EXTERNAL_IP}` open in the browser:
   - **Preferred display language** — choose your language and click **Next**.
   - **Create your admin account** — enter a username and a strong password. This
     becomes the Emby owner; it is the only administrator until you add more.
     There is no pre-seeded credential in Secret Manager.
   - **Setup Media Libraries** — you can skip this here and add one in the next
     step from the Dashboard, or add your first library inline.
   - **Preferred metadata language / country** — set the language Emby uses when
     it fetches artwork, descriptions, and other metadata, then **Next**.
   - **Remote access** — leave *Allow remote connections to this server* enabled (the
     LoadBalancer Service already exposes it); you can leave automatic port mapping
     off. Click **Next**, then **Finish**. Emby restarts into the login screen —
     sign in with the admin account you just created. (This step is where Emby
     would offer an optional Emby Connect sign-in — it is informational only and
     can be skipped entirely.)

2. **Add a media library.** From the web UI, go to the user menu →
   **Dashboard** → **Libraries** → **Add Media Library**:
   - **Content type** — choose what the folder holds, e.g. **Movies**, **Shows**,
     **Music**, or **Photos**.
   - **Display name** — give the library a name (e.g. `Movies`).
   - **Folders** — click the **+** and point Emby at a path *under the persistent
     volume*, e.g. `/config/media/movies`. Anything under `/config` is on the block
     PVC and survives pod restarts, rescheduling, and redeploys; a path outside
     `/config` lives on the pod's ephemeral disk and is lost when the pod recycles.
     Create the folder and seed a sample file first if it does not exist (see the note
     below on getting media onto the volume).
   - Accept the metadata-download defaults and click **Ok**, then **Ok** again to
     save the library.

3. **Scan and fetch metadata.** Emby scans the new library automatically; you can
   force a scan from **Dashboard → Libraries → Scan All Libraries** (or the three-dot
   menu on the library → **Scan Library**). It matches each file against online
   providers and downloads titles, artwork, and descriptions in the metadata
   language you chose.

4. **Browse and confirm playback.** Return to the Emby home screen — your new
   library appears with its poster art. Open it, select an item, and press **Play**.
   For a smooth demo, prefer media the client can **direct-play** (a codec/container
   the browser supports natively): on-the-fly transcoding is CPU-heavy and there is
   no GPU on Autopilot, so a transcode of a large file may stutter unless you have
   sized CPU up. Hardware-accelerated transcoding additionally requires Emby
   Premiere.

> **Getting media onto the `/config` volume:** the PVC is a block disk mounted only
> inside the pod, so copy files in through the pod itself. Stream a local file
> straight into the library path you referenced above:
> ```bash
> POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
> kubectl exec -n "$NS" "$POD" -- mkdir -p /config/media/movies
> kubectl cp ./my-movie.mp4 "$NS/$POD:/config/media/movies/my-movie.mp4"
> ```
> Block storage is the right fit for a real media library plus transcode cache. For
> a **large** media collection, consider fronting it with **NFS** (`enable_nfs`)
> rather than growing the block PVC — the shared NFS is sized for bulk media while the
> PVC keeps the latency-sensitive SQLite store and cache local.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and the PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scaling — keep it single-replica.** Emby is a stateful single-server
   application: its SQLite databases and transcode cache live on one `/config` PVC
   and are not designed for concurrent writers. The module defaults to a single
   replica (`min_instance_count = 1`, `max_instance_count = 1`) for exactly this
   reason — **keep `max_instance_count = 1`**. If playback needs more headroom, scale
   *up* (raise `cpu_limit` above the default `1000m` and `memory_limit` above `1Gi`
   for live transcoding), not *out*. Apply changes by editing the inputs and clicking
   **Update** — the module owns the workload spec, so a manual `kubectl scale` would
   be reverted on the next apply.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and the StatefulSet pod is
   replaced. Because the state lives on the `/config` PVC (which is retained across
   the pod replacement), the new pod picks up your libraries and settings.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~emby"
   kubectl get pvc -n "$NS"          # the /config block volume that holds all state
   ```

   The state that matters is the `/config` PVC — the SQLite databases plus metadata,
   plugins, and user settings. If you enabled the optional API key
   (`enable_api_key = true`), its 32-character value is stored in Secret Manager as
   `secret-<prefix>-<app>-api-key` and injected as `EMBY_API_KEY`; note that Emby's
   own application API keys are created separately in **Dashboard → API Keys**.

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. Watch CPU during
   playback — sustained saturation usually means a client is triggering a transcode
   and you should raise `cpu_limit` or steer clients toward direct-play. The module
   can provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Emby releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  is a **TCP** check on port 8096 — it passes as soon as Emby's listener binds, so a
  pod failing this probe almost always means the container never reached that point
  (a build/entrypoint problem or a PVC mount failure), not an app-level health issue.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC Pending / pod stuck scheduling:** confirm the PersistentVolumeClaim bound and
  Autopilot could provision the disk:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc>
  ```
- **Libraries or settings disappeared after a redeploy:** confirm the media path you
  referenced is under `/config` (the PVC mount). A path outside `/config` is
  ephemeral and is lost on every pod recycle.
- **Playback stutters or times out:** almost always a transcode under a 1 vCPU
  limit. Prefer direct-play media, or raise `cpu_limit`/`memory_limit`. Hardware
  transcoding requires Emby Premiere and is not available on Autopilot regardless.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping `max_instance_count = 1` and sizing CPU for transcoding).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the `/config` **PersistentVolumeClaim** (**including your SQLite
databases, metadata, and any media you copied onto it**), Secret Manager secrets, and
Artifact Registry images. If you want to keep your library, copy the media off the PVC
first (Task 3). Resources owned by **Services_GCP** (the VPC, GKE cluster, registry,
shared service accounts) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the StatefulSet with a `/config` block PVC and builds the image (no external DB) |
| 2 — Access & verify | Manual | Connect to the cluster; `/` returns a 302 to the setup wizard at the LoadBalancer IP |
| 3 — Worked example | Manual | Complete the wizard, create the admin, add a media library on the `/config` PVC, scan and browse |
| 4 — Operate | Manual | Inspect the StatefulSet/PVC, keep single-replica, size CPU, update version, manage secrets/storage |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose pod, PVC, persistence, transcoding, scheduling, and image-pull issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources, including the `/config` PVC |
