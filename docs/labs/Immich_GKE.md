---
title: "Immich on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Immich on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Immich on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Immich_GKE)**

## Overview

**Estimated time:** 60–90 minutes

Immich is an open-source, self-hosted photo and video management platform — a
Google Photos alternative with mobile auto-backup, smart search, and face
recognition. This lab takes you through the full operational lifecycle of the
**Immich on GKE Autopilot** module: deploy it, create the admin account, upload a
photo, prove that smart search really exercises the machine-learning service,
prove that the NFS-backed media library survives a pod loss, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Immich product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Immich_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Wait for the workload to become healthy and verify it end-to-end.
- Complete Immich's interactive first run (admin account) and upload media.
- Verify that smart search actually reaches the machine-learning service.
- Demonstrate that the media library survives pod deletion (NFS persistence and
  the Recreate deployment strategy).
- Tear the deployment down cleanly.

## Task 1 — Prerequisites & authentication

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, the **NFS server VM** — which both hosts the media library
  and co-hosts Redis, two things Immich cannot run without — and Artifact
  Registry). Confirm the NFS VM is `RUNNING` before deploying:
  ```bash
  gcloud compute instances list --project="$PROJECT" --filter="name~nfs" \
    --format="table(name,zone,status)"
  ```
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; authenticate:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  gcloud config set project "$PROJECT"
  ```
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 2 — Deploy the module and wait for healthy [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Immich (GKE)** from
   the **Platform Modules** list, set `project_id`, and review the inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Immich_GKE)
   documents every input by group. Note that `enable_nfs`, `enable_redis`, and
   `max_instance_count = 1` are enforced by plan-time validations — do not fight
   them. Review the estimated credit cost and click **Deploy**; the deployment
   status page streams real-time logs.

2. The platform builds the thin custom server image (over
   `ghcr.io/immich-app/immich-server` — `latest` resolves to Immich's rolling
   `release` tag), provisions Cloud SQL (PostgreSQL 15), runs the one-shot
   `db-init` job (database, user, `pgvector` + `earthdistance` extensions), mounts
   the NFS media library at `/usr/src/app/upload`, and deploys two workloads: the
   Immich server (port 2283) and the machine-learning service (port 3003,
   internal-only). First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep immich | head -1 | cut -d/ -f2)
   echo "Namespace: $NS"
   kubectl get pods -A | grep immich
   ```

4. Wait for both Deployments (server and ML) to roll out:

   ```bash
   for D in $(kubectl get deploy -n "$NS" -o name); do
     kubectl rollout status -n "$NS" "$D" --timeout=600s
   done
   kubectl get pods,svc -n "$NS"
   ```

5. Verify health at the application level. Immich's `/api/server/ping` endpoint is
   unauthenticated and returns `{"res":"pong"}`:

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping"            # expect {"res":"pong"}
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping" | wc -c    # must be non-zero
   ```

   Check the **response body**, not just the status code — a `200` with an empty
   body (content-length 0) is a real failure mode, which is why the `wc -c` count
   must be non-zero. If the port is not reachable directly, check the Service's exposed port with
   `kubectl get svc -n "$NS"` and use that instead. The first lines of the server
   pod log show the resolved DB/Redis/media configuration printed by the cloud
   entrypoint — the fastest sanity check:

   ```bash
   kubectl logs -n "$NS" "$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1)" | head -15
   ```

---

## Task 3 — Create the admin account [Manual]

1. Open `http://${EXTERNAL_IP}` (or the Service port from Task 2) in a browser. On
   first visit Immich shows the **Getting Started** sign-up screen — there is no
   pre-seeded credential anywhere; the first registered account becomes the admin.

2. Fill in the admin email, password, and name, and complete the sign-up. You land
   in the Immich web UI.

3. (Optional) Install the Immich mobile app (iOS/Android) and point it at the same
   server URL — mobile auto-backup uses the identical API you just verified.

---

## Task 4 — Upload a photo [Manual]

1. In the web UI, click **Upload** (top right) and select a photo from your
   machine. Any JPEG works; a photo with recognisable objects (a dog, a car, a
   beach) makes Task 5 more satisfying.

2. Confirm the asset appears in the timeline, then confirm it physically landed on
   the NFS-backed library:

   ```bash
   SERVER_POD=$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$SERVER_POD" -- df -h /usr/src/app/upload   # NFS mount, not overlay
   kubectl exec -n "$NS" "$SERVER_POD" -- find /usr/src/app/upload -type f | head
   ```

   The upload path is `IMMICH_MEDIA_LOCATION` — the module validates that this is
   an NFS mount precisely so the files you just listed survive any pod loss
   (proven in Task 6).

---

## Task 5 — Verify smart search hits the ML service [Manual]

Smart search and face recognition run in a **separate machine-learning container**
(CPU inference), which the server reaches via the injected
`IMMICH_MACHINE_LEARNING_URL`. Prove the wiring end-to-end:

1. Confirm the env var, prove the server can actually reach the ML service
   through it, and find the ML pod:

   ```bash
   kubectl exec -n "$NS" "$SERVER_POD" -- env | grep IMMICH_MACHINE_LEARNING_URL
   # Server → ML connectivity via the injected URL (the real Service DNS name):
   kubectl exec -n "$NS" "$SERVER_POD" -- sh -c 'curl -s "$IMMICH_MACHINE_LEARNING_URL/ping"'
   kubectl exec -n "$NS" "$SERVER_POD" -- sh -c 'curl -s "$IMMICH_MACHINE_LEARNING_URL/ping" | wc -c'  # must be non-zero
   ML_POD=$(kubectl get pods -n "$NS" -o name | grep ml | head -1 | cut -d/ -f2)
   echo "ML pod: $ML_POD"
   ```

   The `/ping` call must return a **non-empty body** — a `200` with an empty
   response is a failure. If the curl hangs or refuses, the ML pod is likely
   listening on the wrong port (`IMMICH_PORT` must be `3003` on the ML service)
   or the URL is not the real Service DNS name (`http://<service>-ml:3003`).

2. Follow the ML pod logs in one terminal:

   ```bash
   kubectl logs -n "$NS" "$ML_POD" -f
   ```

3. In the web UI, use the search bar to run a **smart search** for a term matching
   your photo (e.g. "dog" or "beach"). Expect two things:

   - The ML log shows activity — on the very first request it **downloads the CLIP
     model** before answering, so the first search takes noticeably longer
     (subsequent searches are fast). Model files cache on the ML pod's ephemeral
     disk and re-download after a rescheduling; this is expected.
   - The search returns your photo (embedding jobs run shortly after upload; if
     the result is empty, wait a minute and check Administration → Jobs
     in the UI for the Smart Search queue).

4. If search returns nothing and the ML log never moves, check the ML pod for
   memory pressure — model load OOMs below the 4Gi default and the main app keeps
   looking healthy while smart search silently fails:

   ```bash
   kubectl describe pod -n "$NS" "$ML_POD" | grep -A3 "Last State"   # look for OOMKilled
   ```

---

## Task 6 — Prove the library survives a pod delete [Manual]

The media library lives on NFS, and NFS-backed apps deploy with the `Recreate`
strategy (the old pod fully stops before a new one starts — no two writers on the
same library). Simulate a pod loss and confirm nothing is lost:

1. Delete the server pod and watch the replacement come up:

   ```bash
   kubectl delete pod -n "$NS" "$SERVER_POD"
   kubectl rollout status -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)" --timeout=600s
   kubectl get pods -n "$NS"
   ```

   Expect a short window with **zero** server pods (Recreate, single replica) —
   this is by design, not a fault.

2. Confirm the health endpoint answers again and the photo is still there:

   ```bash
   curl -s "http://${EXTERNAL_IP}:2283/api/server/ping"
   NEW_POD=$(kubectl get pods -n "$NS" -o name | grep -v ml | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$NEW_POD" -- find /usr/src/app/upload -type f | head
   ```

3. Reload the web UI: the timeline still shows your photo, served by a brand-new
   pod from the same NFS library. This is exactly the failure the
   `enable_nfs = true` validation protects against — on ephemeral disk, step 2
   would have returned an empty library.

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it, use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources. Delete removes everything the
module created — the Kubernetes workloads and namespace (server and ML), the Cloud
SQL database and user, and the built Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL instance, the NFS server
and its data, the registry) are managed separately and are not removed here — note
that the media library directory lives on the shared NFS volume.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Prerequisites | Manual | Auth completed; Services_GCP and the NFS VM confirmed present and RUNNING |
| 2 — Deploy & wait healthy | Automated | Server + ML workloads rolled out; `/api/server/ping` returns `pong` |
| 3 — Admin account | Manual | First-run sign-up completed in the web UI |
| 4 — Upload | Manual | Photo uploaded and confirmed on the NFS-backed library |
| 5 — Smart search | Manual | Search verified end-to-end against the machine-learning pod (logs + `IMMICH_MACHINE_LEARNING_URL`) |
| 6 — Persistence | Manual | Pod deleted; Recreate rollout observed; photo survived on NFS |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
