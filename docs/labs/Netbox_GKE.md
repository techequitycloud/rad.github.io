---
title: "NetBox on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy NetBox on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# NetBox on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_GKE)**

## Overview

**Estimated time:** 60–90 minutes

NetBox is the industry-standard open-source network and infrastructure
documentation / IPAM (IP address management) tool — device and rack
inventory, IP address and prefix tracking, cabling, and network topology,
modeled as structured data behind a full API. This lab takes you through the
full operational lifecycle of the **NetBox on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on NetBox product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running pod, including confirming media uploads
  actually persist to Cloud Storage.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, using
  `kubectl exec` to get real evidence rather than guessing from logs alone.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace-from-outputs>"

gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **NetBox (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Netbox_GKE)
   documents every input by group, with defaults. If your project has a tight
   static-IP quota, set `service_type = "ClusterIP"` and
   `reserve_static_ip = false` for an internal-only deployment. Review the
   estimated cost (if credits are enabled) and click **Deploy**, which opens
   the deployment status page with real-time logs.

2. The platform provisions the GKE workload, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`SECRET_KEY`, `SUPERUSER_PASSWORD`,
   and the database password), a Cloud Storage `media` bucket mounted via GCS
   Fuse CSI, builds the custom container image (wrapping `netboxcommunity/netbox`),
   and runs a one-shot database-initialisation Job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE" -l app~netbox
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -i netbox | head -1)
   echo "Service: $SERVICE"
   kubectl get "$SERVICE" -n "$NAMESPACE" -o wide
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and healthy:

   ```bash
   kubectl get pods -n "$NAMESPACE"    # expect Running, 0 restarts
   ```

2. Reach the service. If `service_type = "LoadBalancer"`, use the external IP
   from `kubectl get svc`; if `service_type = "ClusterIP"`, port-forward:

   ```bash
   kubectl port-forward -n "$NAMESPACE" "$SERVICE" 18080:8080
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/login/"   # expect 200
   ```

3. Retrieve the auto-generated admin credentials and log in via the browser
   (or `http://localhost:18080/login/` if port-forwarding):

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Log in as `admin` (or your configured `admin_user`) with that password.
   You should land on the NetBox dashboard.

4. **Verify media uploads actually persist** — this exercises the exact code
   path this module needed a real fix for. Upload an image attachment to any
   object in the UI, then confirm it landed in the backing GCS bucket rather
   than the pod's local disk:

   ```bash
   MEDIA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~media" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$MEDIA_BUCKET/"
   ```

   You should see the uploaded file within a few seconds.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy -n "$NAMESPACE"
   kubectl rollout status deploy/<service-name> -n "$NAMESPACE"
   kubectl rollout history deploy/<service-name> -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max replica inputs and clicking **Update** on
   the deployment details page — the module owns the Deployment spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit is reverted on the next apply, and GKE has no scale-to-zero: at least
   `min_instance_count` pods are always running). NetBox's background RQ
   worker is co-located in the same pod and, unlike Cloud Run, runs
   continuously by default since GKE keeps at least one pod always running.

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds (passing
   `application_version` through as the Dockerfile's `APPLICATION_VERSION`
   build ARG) and a rolling update deploys it.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netbox"
   kubectl get jobs -n "$NAMESPACE"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=netbox --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard for the deployment and
   review pod CPU/memory utilisation, restart count, and HPA scaling
   behaviour. Uptime checks require a publicly reachable endpoint
   (`service_type = "LoadBalancer"`); if configured, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. Unlike
Cloud Run, GKE gives you a real shell inside the running container — use it.

- **Pod unhealthy / CrashLoopBackOff:** inspect events and logs. The startup
  probe targets `/login/` and allows up to 60 retries at 10-second intervals
  on first boot.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  kubectl logs -n "$NAMESPACE" <pod-name> --previous
  ```
- **Login fails with a CSRF error:** the workload's `CSRF_TRUSTED_ORIGINS`
  must match its actual reachable URL. Confirm what's actually injected:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CSRF
  ```
- **Uploads "succeed" in the UI but never show up in the GCS bucket — this is
  the single most instructive failure mode for this module.** A GCS Fuse
  volume mounted at the wrong path leaves uploads on the pod's ephemeral
  filesystem, where they read back fine (fooling a quick UI check) but vanish
  on the next pod restart, with **no error anywhere in the logs**. This is
  exactly the bug that shipped in an earlier revision of this module — and it
  was only actually diagnosed by getting a real shell into the pod and asking
  NetBox itself where it thinks its media root is, rather than guessing from
  documentation or the image layout:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell \
    -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
  # then confirm the GCS mount matches:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /etc/netbox/media
  gcloud storage ls "gs://$MEDIA_BUCKET/"
  ```
  If a Cloud-Run-only version of this module ever exhibits a symptom that
  looks like "the platform can't persist data here," and a GKE equivalent
  exists, deploying the GKE variant purely to get shell access is a
  legitimate diagnostic step — it is what actually solved this exact bug.
- **Permission denied writing to the GCS mount:** confirm the mount's `uid`/`gid`
  options match the container's actual runtime user (NetBox's official image
  runs as root, uid 0):
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- id
  ```
- **Webhooks / reports / scheduled jobs never run:** confirm the RQ worker
  process is actually alive inside the pod (it should be, continuously, since
  GKE has no scale-to-zero):
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep rqworker
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the initialisation Job
  completed successfully.
- **Initialisation job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the Workload Identity binding and the
  Kubernetes ServiceAccount's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the GKE workload and Service, Cloud SQL database, Secret Manager secrets, GCS
buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, media bucket, and runs DB init |
| 2 — Access & verify | Manual | Pod healthy; log in with the auto-generated admin credential; confirm media uploads land in GCS |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE Workloads dashboard and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, CSRF, GCS-mount permission, media-persistence, background-worker, database, init-job, build, and IAM issues using `kubectl exec` |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
