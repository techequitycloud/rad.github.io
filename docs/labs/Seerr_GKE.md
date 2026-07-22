---
title: "Seerr on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Seerr on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Seerr on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Seerr is the 2026 merger of Jellyseerr and Overseerr — a request UI that
sits in front of Jellyfin, Plex, or Emby, letting users browse and request
titles for an admin to approve. This lab takes you through the full
operational lifecycle of the **Seerr on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Seerr product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and complete Seerr's first-run setup wizard.
- Confirm the GKE-specific GCS-FUSE permission fix at `/app/config` is in effect, and understand what breaks without it.
- Perform day-2 operations — inspect, scale, and update.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service
  accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- (Optional) An existing Jellyfin, Plex, or Emby instance, plus Sonarr/Radarr, to connect during Seerr's setup wizard.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Seerr (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Kubernetes Deployment (or StatefulSet, if you
   opted into `stateful_pvc_enabled = true`), a Cloud SQL PostgreSQL 15
   database/role, a `storage` GCS bucket mounted at `/app/config` via GCS
   FUSE, and a Secret Manager secret holding the generated database
   password. There is **no first-run admin credential to retrieve** — the
   admin account is created through the app's own setup wizard. First
   deploys typically take **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep seerr | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving — 3/3 `Ready`, matching what was
   confirmed at live deployment:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/api/v1/status" | head -c 300; echo
   # expect JSON: {"version":"...","commitTag":"...", ...}
   ```

   You can also verify this from inside the pod directly:

   ```bash
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NAMESPACE" "$POD" -- curl -s http://localhost:5055/api/v1/status
   ```

2. Open `http://$EXTERNAL_IP` (or your custom domain, if configured) in a
   browser and complete Seerr's **first-run setup wizard**: sign in, connect
   your Jellyfin/Plex/Emby server, then Sonarr/Radarr.

3. **Confirm the GKE GCS-FUSE permission fix took effect.** If the pod is
   `Running` with `0` restarts (checked above), this already passed — a
   missing or misconfigured `uid`/`gid` mount option would show up as a
   `CrashLoopBackOff` with `EACCES: permission denied` in the pod's events,
   not a silent failure. As a positive confirmation, check the mounted
   settings directory is writable and populated:

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /app/config
   # expect: settings.json, settings.old.json, db/, logs/ — all owned by uid 1000
   ```

4. **Confirm Postgres is actually in use, not the SQLite fallback:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].env}' | grep -o '"name":"DB_TYPE"[^}]*'
   # expect: "name":"DB_TYPE","value":"postgres"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # Deployment mode (default)
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"       # StatefulSet mode, if stateful_pvc_enabled = true
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Scale** — the module default is `min_instance_count = 1` /
   `max_instance_count = 5`. If several pods might edit Seerr's settings
   (media server config, discovery sliders, notification agents)
   concurrently, consider lowering `max_instance_count` to `1` via the RAD
   platform's **Update** flow — `settings.json` is a single mutable file,
   not a transactional database, so concurrent writers risk a lost write.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Since the image is genuinely prebuilt (`ghcr.io/seerr-team/seerr`),
   no local Cloud Build step is involved.

4. **Manage secrets and storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~seerr"
   kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Monitoring** — open the GKE Workloads dashboard for the workload and
   review CPU/memory utilisation and replica count.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod `CrashLoopBackOff` with `EACCES: permission denied` on
  `/app/config/logs/`.** This is the GKE GCS-FUSE UID/GID bug this module
  fixes — if you see it, you are most likely running a fork or a custom
  `gcs_volumes` override that bypassed `Seerr_Common`'s `mount_options`
  (`uid=1000`, `gid=1000`, `file-mode=0664`, `dir-mode=0775`). Confirm:
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```

- **Settings (media server connection, sliders, notification agents) seem
  to "reset" after a redeploy or restart.** This is the classic symptom of
  the `DB_TYPE` trap — Seerr silently fell back to a per-pod SQLite
  database. Verify `DB_TYPE=postgres` is actually injected (see Task 2, step
  4).

- **Pod unhealthy for another reason:** inspect pod events and logs. The
  startup probe targets `/api/v1/status`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```

- **App boots and passes health checks, but the request history is empty
  after a pod reschedule.** Confirm the Cloud SQL instance and database role
  exist, and that `enable_cloudsql_volume = true`:
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project="$PROJECT"
  ```

- **401/403 errors calling Sonarr/Radarr from inside Seerr's request
  approval flow.** Application-layer credential issue inside Seerr's own
  settings, not a platform/module issue — re-check the API key and base URL
  entered in Seerr's Settings → Services page.

- **403 / permission errors from GCP itself:** verify the Workload Identity binding.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use
**Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. This removes everything the module created —
the Kubernetes workload, Service, PVC (if used), the Cloud SQL
database/role, Secret Manager secrets, and the GCS settings bucket.
Resources owned by **Services_GCP** (the VPC, GKE cluster, registry, Cloud
SQL instance itself) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL PostgreSQL, and a GCS-FUSE settings volume |
| 2 — Access & verify | Manual | Pod Ready, `0` restarts; `/api/v1/status` returns JSON; confirm the GCS-FUSE permission fix and `DB_TYPE=postgres` |
| 3 — Operate | Manual | Inspect rollout, understand the concurrency/settings-write tradeoff, update version, manage storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose GCS-FUSE permission, DB_TYPE-fallback, and pod-health issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including storage and the database |
