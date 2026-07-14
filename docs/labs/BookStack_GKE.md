---
title: "BookStack on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy BookStack on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# BookStack on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/BookStack_GKE)**

## Overview

**Estimated time:** 45–90 minutes

BookStack is a free, open-source wiki and documentation platform for organising
knowledge into a simple shelves → books → chapters → pages hierarchy. It is built
on Laravel (PHP) and backed by MySQL. This lab takes you through the full
operational lifecycle of the **BookStack on GKE** module on Google Cloud
(GKE Autopilot): deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on BookStack product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/BookStack_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  GKE Autopilot cluster, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<bookstack-namespace>"   # the module's Kubernetes namespace (from Task 1)
```

Fetch cluster credentials so `kubectl` targets the Autopilot cluster:

```bash
CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **BookStack (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/BookStack_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the GKE Autopilot workload (Deployment) and a
   `LoadBalancer` Service with a reserved static IP, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager secrets (the Laravel `APP_KEY` and the database
   password), a Cloud Storage `bookstack-uploads` bucket, an NFS volume mounted at
   `/var/lib/bookstack` for uploaded images and attachments, mirrors the prebuilt
   `linuxserver/bookstack` image into Artifact Registry, and runs a one-shot
   database-initialisation (`db-init`) job that creates the database, application
   user, and grants. On GKE the database is reached through a Cloud SQL Auth Proxy
   sidecar on `127.0.0.1:3306`. BookStack's LinuxServer image then runs
   `php artisan migrate` automatically on first boot, so the schema is created on
   start (there is no separate migrate job). First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $SERVICE_IP"
   export SERVICE_URL="http://$SERVICE_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. BookStack exposes
   an unauthenticated JSON health endpoint that reports application, database,
   cache, and session status:

   ```bash
   curl -s "$SERVICE_URL/status"   # expect a JSON object with status fields
   ```

2. Open `$SERVICE_URL` in a browser (the LoadBalancer external IP from Task 1).
   BookStack ships with a default first-run administrator: **`admin@admin.com`** /
   **`password`**. Sign in, then **immediately** change the password and the admin
   email address under **Settings → Users**. Once you are in, organise your content
   using BookStack's hierarchy — **shelves** hold **books**, books hold **chapters**,
   and chapters hold **pages**.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its pods** (each deploy rolls out a new pod template;
   the Deployment shifts traffic to healthy pods):

   ```bash
   kubectl get deployment,pods -n "$NAMESPACE"
   kubectl describe deployment -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` edit (a manual edit would be reverted on the next apply).
   BookStack on GKE defaults to `min_instance_count = 1` and `max_instance_count = 1`;
   GKE has **no scale-to-zero**, so at least one replica always runs. Because uploads
   live on a shared NFS volume, the module deploys with the `Recreate` strategy and a
   single pod — do not scale beyond one replica without enabling Redis
   (`enable_redis = true`) for shared cache and sessions. A PodDisruptionBudget guards
   the workload against involuntary eviction during node maintenance.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**. BookStack uses the prebuilt `linuxserver/bookstack`
   image, so a version bump re-pulls the mirrored image tag and rolls out a new pod
   (no custom build runs). Pin a specific tag (e.g. `version-v24.10`) in production
   rather than the default `latest`.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~bookstack"
   kubectl get jobs -n "$NAMESPACE"   # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=bookstack --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" -l app --tail=50
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards for the workload and review
   request throughput, latency, pod count and restarts, and CPU / memory utilisation.
   The module also provisions an **uptime check** against the LoadBalancer endpoint;
   confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with BookStack releases.

- **Pod unhealthy / service won't serve:** inspect the pod and its logs for startup
  errors, and confirm env vars and secrets resolved. The liveness probe targets
  `/status` with a generous first-boot window (300s initial delay) so the image's
  automatic `php artisan migrate` can finish before the probe fails.
  ```bash
  kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
  kubectl describe pod -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app --tail=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  `DB_PASSWORD` secret exists, the Cloud SQL Auth Proxy sidecar is running on
  `127.0.0.1:3306`, and the `db-init` job completed successfully. BookStack connects
  using the Laravel-native `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` env vars.
- **Initialisation job failed:** inspect the `db-init` job and read the failed pod's logs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```
- **Image mirroring / pull errors:** confirm the `linuxserver/bookstack` image was
  mirrored into Artifact Registry and the pulled tag exists (`kubectl describe pod`
  surfaces `ImagePullBackOff`).
- **403 / permission errors:** verify the workload's Workload Identity service account
  and its IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot —
doing so makes all previously encrypted database values undecryptable). Note that the
GKE variant's shipped `liveness_probe` default path is a stale WordPress leftover
(`/wp-admin/install.php`); the correct BookStack health path is `/status` — set it
explicitly if the default has not been corrected in your deployment.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the GKE workload and its namespace,
the LoadBalancer and reserved static IP, the Cloud SQL database, Secret Manager
secrets (including `APP_KEY`), GCS buckets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, GKE cluster, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, LoadBalancer, Cloud SQL (MySQL 8.0), secrets, `bookstack-uploads` bucket, NFS, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; sign in and change the default admin credentials |
| 3 — Operate | Manual | Inspect pods, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, image, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
