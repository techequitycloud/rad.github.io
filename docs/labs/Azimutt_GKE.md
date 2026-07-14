---
title: "Azimutt on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Azimutt on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Azimutt on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Azimutt is an open-source, next-generation database-schema explorer and ERD
(entity relationship diagram) tool for real-world databases, built with
Elixir/Phoenix. This lab takes you through the full operational lifecycle of
the **Azimutt on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Azimutt product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Azimutt (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Azimutt_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`SECRET_KEY_BASE` and the database password), a Cloud Filestore (NFS) share
   for Azimutt's attachment storage, a Cloud Storage bucket, builds the
   container image (a thin wrapper FROM `ghcr.io/azimuttapp/azimutt`), and runs
   a one-shot database-initialisation job that creates the application role and
   database. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep azimutt | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Azimutt has no dedicated health JSON
   endpoint — the startup and liveness probes target the Phoenix root `/`,
   which only returns `200` once the server has booted, applied its migrations,
   and connected to Postgres:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit Azimutt shows its
   sign-up page — no pre-seeded admin credential exists in Secret Manager.
   Create your first account with an email and password. Sign-up is **open by
   default**, so after creating your account, restrict further access (custom
   domain + IAP, or Azimutt's own auth settings via `environment_variables`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). Unlike apps with an in-memory job queue,
   Azimutt uses PostgreSQL (Oban) for background work, so scaling beyond one
   replica needs no Redis. GKE does not support scale-to-zero, so
   `min_instance_count` stays at its default of `1`. `session_affinity =
   ClientIP` is set by default to keep a client pinned to one pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pods. Migrations run automatically on every boot
   (`/app/bin/migrate && /app/bin/server`), so an upgrade applies its schema
   changes on start — allow extra time on the first boot after a version bump.
   Azimutt publishes no `:latest` tag (`application_version = "latest"` maps to
   its `main` tag); pin to a specific release in production.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~azimutt"
   kubectl get jobs -n "$NAMESPACE"           # db-init job
   gcloud filestore instances list --project="$PROJECT"
   ```

   Never rotate `SECRET_KEY_BASE` outside a maintenance window — rotating it
   invalidates every active session cookie and signs out all users.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=azimutt --database=azimutt --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The `cloud-entrypoint` lines
   show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Azimutt releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  and liveness probes target `/` with a 60-second initial delay — allow ~1–2
  minutes on first boot for migrations to finish before the endpoint binds.
  `container_port` and the Service/probe ports must all be **4000** (GKE does
  not auto-inject `PORT`; the entrypoint defaults it) — a mismatch leaves the
  pod stuck `Running` but never `Ready`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and `enable_cloudsql_volume = true`. Azimutt connects through the **Cloud SQL
  Auth Proxy sidecar** on `127.0.0.1` (TLS terminated by the proxy, so
  `DATABASE_ENABLE_SSL=false`) — disabling the sidecar leaves Azimutt with no
  database.
- **Initialisation job failed:** inspect the job and its pod logs. The job
  signals the proxy sidecar to shut down (`/quitquitquit`) once it completes:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it. Because Azimutt's image is a
  rebuilt/mirrored wrapper, `imagePullPolicy = Always` is set so nodes never
  serve a stale cached layer.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`SECRET_KEY_BASE` after first boot, and why `application_database_name`/
`application_database_user` are immutable after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, Cloud Filestore
share, GCS bucket, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), NFS share, secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check (`/`) passes; create the first Azimutt account in the UI |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
