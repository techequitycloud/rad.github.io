---
title: "Flarum on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Flarum on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Flarum on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Flarum is a free, open-source forum and discussion platform — a modern,
extensible alternative to traditional bulletin-board software, built on PHP
with a JavaScript/Mithril front end. This lab takes you through the full
operational lifecycle of the **Flarum on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Flarum forum features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and retrieve the
  generated admin credential.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service
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

1. Click **Deploy** in the RAD platform top navigation, open **Flarum (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Flarum_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   a Cloud SQL (MySQL 8.0) database with its Secret Manager secrets (the
   auto-generated `FLARUM_ADMIN_PASS`; the database password is managed
   separately), a Cloud Filestore (NFS) share for uploaded avatars/attachments,
   a `flarum-assets` Cloud Storage bucket, builds the container image (a thin
   wrapper `FROM mondedie/flarum`), and runs a one-shot database-initialisation
   job. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep flarum | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address (a static IP
   is reserved by default, so it survives redeploys):

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Flarum serves its public forum home page
   at `/` once installed and the database is reachable:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Retrieve the generated administrator password — the admin username and
   email are fixed by the module at `admin` / `admin@techequity.cloud` and
   are not exposed as configuration inputs:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~flarum AND name~admin-pass" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` in a browser and sign in with `admin` / the
   password retrieved above. **`FORUM_URL` is a known gap on this variant —
   it is NOT set automatically.** Set it once the external IP or custom
   domain is known, or Flarum will generate incorrect absolute links, asset
   URLs, and redirects:

   ```bash
   SERVICE_NAME=$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SERVICE_NAME" -n "$NAMESPACE" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"flarum","env":[
       {"name":"FORUM_URL","value":"http://'"${EXTERNAL_IP}"'"}]}]}}}}'
   ```

   Note that a manual `kubectl patch` is overwritten on the next **Update** —
   set `FORUM_URL` permanently via the module's `environment_variables` input
   once you know the durable public address.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is
   a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). Keep `max_instance_count` at `1` unless
   you have verified Flarum's behaviour under multiple concurrent pods
   sharing the same NFS assets volume and database. Session affinity
   (`ClientIP`) is set by default to keep a client routed to the same pod.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying it via **Update**; the value is
   passed through the app-specific `FLARUM_VERSION` build ARG (not the
   generic version arg), a new image builds, and — because the workload is
   NFS-backed — the rollout uses the **`Recreate`** strategy (old pod
   terminates before the new one starts) rather than a rolling update, to
   avoid two pods deadlocking on the shared NFS volume and database.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~flarum"
   kubectl get jobs -n "$NAMESPACE"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=flarum --database=flarum --project="$PROJECT"
   ```

6. **Check uploaded assets persistence** — avatars and attachments live on
   Cloud Filestore (NFS) at `/flarum/app/public/assets`, mounted because
   `enable_nfs = true` by default, and shared across pods:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

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
platform-level diagnostics and do not change with Flarum releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is a **TCP** check on port 8888 with a generous ~5-minute window
  (`failure_threshold=20`, `period_seconds=15`) to accommodate the first-boot
  installer, and the liveness probe is HTTP `GET /` with a 300-second initial
  delay.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** on GKE, Flarum connects through the **Cloud
  SQL Auth Proxy sidecar on `127.0.0.1:3306`** (`enable_cloudsql_volume =
  true`, required whenever a real database engine is configured). Confirm the
  Cloud SQL instance is `RUNNABLE`, the sidecar container is healthy, and the
  `db-init` job completed.
- **db-init job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (`reserve_static_ip = true` by default keeps it stable across
  redeploys).
- **Broken links / assets pointing at the wrong host:** confirm `FORUM_URL`
  was set to the real external IP or custom domain — this variant does not
  auto-inject it (see Task 2, step 4).
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.
- **Locked out of the admin account:** the `FLARUM_ADMIN_PASS` secret is only
  read on first boot — rotating it afterwards does not change the live admin
  password; reset it from the Flarum admin UI or the database instead.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the immutability of
`application_database_name`/`application_database_user` after first deploy,
and the plan-time validations around `enable_redis`/`redis_host`/`enable_nfs`
and `min_instance_count ≤ max_instance_count`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, the Filestore
(NFS) share, the `flarum-assets` GCS bucket, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), Filestore (NFS), storage bucket, secrets, and runs db-init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve `FLARUM_ADMIN_PASS`, sign in as `admin`, and set `FORUM_URL` |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate rollout), manage secrets/storage, DB access, verify NFS persistence |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, db-init, scheduling, image-pull, and FORUM_URL issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
