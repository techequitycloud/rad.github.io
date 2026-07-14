---
title: "Mixpost on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Mixpost on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Mixpost on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Mixpost is an open-source, self-hosted social media scheduling and management
platform — a Buffer/Hootsuite alternative for composing, scheduling, publishing,
and analysing posts across multiple social accounts from one dashboard. This lab
takes you through the full operational lifecycle of the **Mixpost on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Mixpost product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Understand why this variant keeps at least one pod always running, and what
  that means for scheduled post publishing.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, NFS/Redis host, Artifact Registry, and shared service
  accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Mixpost (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Mixpost_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster (the prebuilt
   `inovector/mixpost` image — no custom build), provisions a Cloud SQL
   (MySQL 8.0) database with its Secret Manager secrets (the Laravel `APP_KEY`
   and the database password), a Cloud Storage bucket, mirrors the prebuilt
   image into Artifact Registry, and runs a one-shot `db-init` job that creates
   the application database and user via the Cloud SQL Auth Proxy sidecar. First
   deploys take roughly **15–30 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep mixpost | head -1 | cut -d/ -f2)
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

   The pod-level startup and liveness probes are both **TCP on port 80**
   (Mixpost answers `/` with a `302` redirect that an HTTP kubelet probe would
   otherwise follow into a dead end at `:443`), so a `1/1 Running` pod is the
   right health signal here rather than an HTTP probe result.

2. Confirm the service responds:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200 or 302
   ```

3. Open `http://${EXTERNAL_IP}` in a browser and sign in. Mixpost's admin account
   is **seeded by the image itself** and is not configurable through this
   module — the `mixpost_admin_email` input is declared but not currently
   injected into the running container. Use the image's documented default
   first-login credentials (`admin@example.com` / `changeme`) and **change the
   password immediately** after first login.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and PVCs:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).
   Session affinity (`ClientIP`) is set by default to keep a client routed to the
   same pod. Because the workload is NFS-backed, updates roll out with the
   `Recreate` strategy (the old pod is terminated before the new one starts) to
   avoid two pods deadlocking on the shared NFS volume and database.

3. **Understand why this variant defaults to always-on.** Unlike the Cloud Run
   variant's cold-start default, this module keeps `min_instance_count = 1` —
   at least one pod is always running, so the supervisord-managed Laravel
   scheduler and queue worker publish scheduled social posts without any
   external Cloud Scheduler wiring. Scaling this to `0` stops scheduled
   publishing entirely; do not do so if scheduled posting is in use.

4. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image is pulled and the pod is recreated —
   there is no separate migration job, since the image runs
   `php artisan migrate --force` on every boot.

5. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~mixpost"
   kubectl get jobs -n "$NS"          # db-init job
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=mixpost --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Mixpost releases.

- **Pod not Ready / restart loop despite the app serving fine on `:80`:**
  confirm `startup_probe_config` / `health_check_config` are still `type =
  "TCP"` — switching them to HTTP reintroduces the 302-redirect trap (the
  kubelet's HTTP probe follows Mixpost's redirect to `https://<pod-ip>:443`,
  where nothing listens).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`db-init` job hangs indefinitely:** confirm `enable_cloudsql_volume = true`
  (required on GKE). Disabling it makes the job's `quitquitquit` shutdown POST
  miss the not-yet-started Auth Proxy sidecar, hanging the job forever.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and the DB password secret materialised into the namespace via the Secret
  Store CSI driver.
- **Scheduled posts not publishing:** confirm `min_instance_count >= 1` — scaling
  to `0` stops the in-pod scheduler and queue worker.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP
  (`reserve_static_ip = true` keeps it stable across redeploys).
- **Login credentials unknown / "admin account not configured":** the admin
  account is seeded by the image itself, not by this module's
  `mixpost_admin_email` variable — use the image's documented default credentials.
- **Image pull errors:** confirm the mirrored image exists in Artifact Registry
  and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including the critical rule never to
rotate `APP_KEY` after first boot, and the immutability of
`application_database_name` / `application_database_user`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, NFS/Redis host, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs `db-init` via the Auth Proxy sidecar |
| 2 — Access & verify | Manual | Connect to the cluster; TCP probes healthy; sign in with the image's default admin credentials and change the password |
| 3 — Operate | Manual | Inspect workload, scale, update version, confirm always-on scheduling, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod probe, `db-init`, database, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
