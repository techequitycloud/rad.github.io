---
title: "PeerTube on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy PeerTube on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PeerTube on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_GKE)**

## Overview

**Estimated time:** 60–90 minutes

PeerTube is an open-source, ActivityPub-federated video hosting platform — a
self-hosted YouTube alternative that federates videos, comments, and channels
with other PeerTube instances (and the wider Fediverse). This lab takes you
through the full operational lifecycle of the **PeerTube on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on PeerTube product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, including the auto-bootstrapped admin account.
- Confirm the GKE-specific GCS-FUSE UID/GID permission fix at `/data` is in effect, and understand what breaks without it.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Understand when to prefer this variant over `PeerTube_CloudRun` (production transcoding, future live streaming).
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL networking, Artifact Registry, and shared
  service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"                 # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **PeerTube (GKE)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_GKE)
   documents every input by group, with defaults. If your project has a
   tight external/static-IP quota, set `service_type = "ClusterIP"` and plan
   to verify via `kubectl port-forward` (Task 2). If you have a real domain
   ready, set `host` now (it becomes immutable once real ActivityPub content
   exists) — otherwise leave it empty and the deployment will derive a
   working federation domain from the predicted GKE service URL
   automatically. Review the estimated cost (if credits are enabled) and
   click **Deploy**, which opens the deployment status page with real-time
   logs.

2. The platform provisions the Kubernetes Deployment (or StatefulSet, if you
   opted into `stateful_pvc_enabled = true`), a Cloud SQL PostgreSQL 15
   database with a Cloud SQL Auth Proxy sidecar, its Secret Manager secrets
   (`PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`, GCS HMAC access/secret
   keys), two Cloud Storage buckets (a public `videos` bucket and a private,
   GCS-FUSE-mounted `data` bucket), builds the custom container image via
   Cloud Build, and runs a one-shot database-initialisation Job (role/database
   creation plus the `pg_trgm`/`unaccent` extensions). First deploys typically
   take **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep peertube | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

   If you deployed with `service_type = "ClusterIP"`, there is no external
   IP — use `kubectl port-forward` instead (Task 2).

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy — **3/3 Running, 0 restarts** is the platform
   health signal this module was verified against (a pod stuck restarting is
   the GCS-FUSE permission bug this module fixes — see Task 5):

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
   ```

2. Reach the public config endpoint. With an external IP:

   ```bash
   curl -s "http://$EXTERNAL_IP/api/v1/config" | head -c 500   # expect real JSON
   ```

   Without one (`service_type = "ClusterIP"`):

   ```bash
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NAMESPACE" "$POD" 19000:9000 &
   curl -s "http://localhost:19000/api/v1/config" | head -c 500        # expect real JSON
   curl -s "http://localhost:19000/api/v1/config/about" | head -c 500  # expect real JSON
   ```

3. **Confirm the GKE GCS-FUSE UID/GID fix took effect.** If the pod is
   `Running` with `0` restarts (checked above), this already passed — a
   missing or misconfigured `uid=`/`gid=` mount option would show up as a
   `CrashLoopBackOff` with `Error: EACCES: permission denied, mkdir
   '/data/logs'` in the pod's events, not a silent failure. As a positive
   confirmation, check the mounted data directory is writable and correctly
   owned:

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /data
   # expect: logs/, avatars/, torrents/, plugins/, tmp/ — all owned peertube:peertube (uid/gid 999)
   ```

4. Retrieve the auto-bootstrapped `root` admin password. PeerTube needs **no
   manual bootstrap step** — the `root` account is created automatically on
   first boot from the `PT_INITIAL_ROOT_PASSWORD` secret:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~root-password" --format="value(name)")
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Open the service URL (or `http://localhost:19000` via the port-forward
   above) at `/login` in a browser and log in as `root` with the retrieved
   password. Confirm the instance's public federation domain (Settings →
   visible in the page footer / instance "About" page) matches what you
   expect — if you left `host` empty, this should show the derived service
   URL.

6. If you plan to run this instance in production, decide on registration
   policy now: `enable_open_registration` defaults `false`. Leave it that
   way unless you deliberately want a public sign-up instance.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # Deployment mode (default)
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"       # StatefulSet mode, if stateful_pvc_enabled = true
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl` edit (a manual
   edit would be reverted on the next apply).

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new image builds via
   the dedicated `PEERTUBE_VERSION` build ARG and a new rollout completes.

4. **Manage secrets and inspect jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~peertube"
   kubectl get jobs -n "$NAMESPACE"    # the db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=peertube --project="$PROJECT"
   ```

6. **Check the video storage buckets:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~peertube"
   gcloud storage ls gs://<videos-bucket>/
   ```

7. **If you need real production transcoding load**, this is the right
   variant for it — raise `cpu_limit`/`memory_limit` well beyond the
   conservative `2000m`/`2Gi` default (PeerTube's own FAQ recommends up to 8
   vCPU/8Gi) via the RAD platform's **Update** flow. The Cloud Run sibling is
   deliberately scoped to VOD/light-transcoding only.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100 -f
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard for the workload and
   review CPU/memory utilisation, replica count, and pod restart count (0
   restarts is the expected steady state — any restart is worth
   investigating, see Task 5). If an uptime check is enabled and
   `service_type = "LoadBalancer"`, confirm it is green under Monitoring →
   Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with PeerTube releases.

- **Pod `CrashLoopBackOff` with `Error: EACCES: permission denied, mkdir
  '/data/logs'`.** This is the GKE-specific GCS-FUSE UID/GID bug this module
  fixes at the `PeerTube_Common` layer — PeerTube's vendor entrypoint chowns
  `/data` to uid/gid 999 in-container, but the GKE GCS FUSE CSI driver
  doesn't honor that chown without an explicit `uid=999,gid=999` mount
  option. If you see this on a fork or a custom `gcs_volumes` override that
  bypassed `PeerTube_Common`'s mount options, that's the cause:
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Pod unhealthy for another reason:** inspect pod events and logs. The
  startup probe is **TCP** on port 9000 (not HTTP) — if the pod never
  becomes Ready, the container likely isn't binding the port at all (check
  for a database connection failure or a missing secret) rather than a slow
  application-level readiness check.
  ```bash
  kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, the `db-init` job completed
  successfully, and `enable_cloudsql_volume = true` (the Auth Proxy sidecar
  must be running for the `127.0.0.1` loopback PeerTube expects).
- **Initialisation job failed:** list Job status and read the failed pod's logs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<service-name>-db-init
  ```
- **Video upload / playback fails with an access error:** check that the
  `videos` bucket's public access prevention is `inherited`, not `enforced`
  — if a manual edit reverted this, the `allUsers:objectViewer` grant
  PeerTube needs will fail:
  ```bash
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```
- **No external IP / service unreachable from a browser.** Expected if you
  deployed with `service_type = "ClusterIP"` (a deliberate choice under an
  IP-quota constraint) — use `kubectl port-forward` (Task 2, step 2) instead
  of expecting a public IP.
- **Image build failed:** review Cloud Build history for the failed build's
  log — a common cause is an invalid `application_version` that doesn't
  resolve to a real `chocobozzz/peertube` tag.
- **403 / permission errors:** verify the Workload Identity binding for the
  storage service account, and specifically its grant on the `videos`
  bucket.
- **Live streaming doesn't work:** this is expected — `enable_live_streaming`
  is not wired in this pass. Unlike the Cloud Run variant (architecturally
  impossible), GKE's networking model could support it with additional
  LoadBalancer Service ports, but that wiring hasn't been implemented yet.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to change `host`
after real ActivityPub content exists, and to never disable `enable_redis`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). Delete removes everything the module
created — the Kubernetes workload and Service (or StatefulSet + PVC, if
used), the Cloud SQL database, Secret Manager secrets, the `videos` and
`data` GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL instance, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, `videos`/`data` buckets, and runs `db-init` |
| 2 — Access & verify | Manual | Pod `3/3 Running`, 0 restarts; config endpoint responds; GCS-FUSE ownership confirmed; log in as the auto-bootstrapped `root` admin |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage secrets, DB and bucket access, raise resources for real transcoding |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose the GCS-FUSE UID/GID bug, pod, database, init-job, storage IAM, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
