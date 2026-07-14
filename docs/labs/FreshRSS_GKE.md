---
title: "FreshRSS on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy FreshRSS on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# FreshRSS on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE)**

## Overview

**Estimated time:** 45–90 minutes

FreshRSS is a free, self-hosted RSS and Atom feed aggregator — a lightweight,
multi-user "news reader" written in PHP that exposes the Google Reader and Fever
APIs for mobile clients. This lab takes you through the full operational lifecycle
of the **FreshRSS on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on FreshRSS product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  first-boot install and admin login.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, NFS server, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **FreshRSS (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys the workload (PHP/Apache on port 80) into the GKE
   Autopilot cluster, provisions a Cloud SQL (PostgreSQL 15) database and user with
   the `FRESHRSS_ADMIN_PASSWORD` and database-password secrets in Secret Manager,
   an NFS volume mounted at `/var/www/FreshRSS/data` (no GCS bucket is created),
   builds the custom container image, and runs a one-shot `db-init` job. First
   deploys take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep freshrss | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. FreshRSS serves an unauthenticated `/status`
   JSON endpoint that responds once the server is up:

   ```bash
   curl -s "http://${EXTERNAL_IP}/status"   # expect a JSON status response
   ```

3. Retrieve the auto-generated admin password from Secret Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freshrss AND name~ADMIN_PASSWORD" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` (or the configured `application_domains` hostname)
   in a browser and log in with username `admin` and the password from step 3. On
   first request the container's entrypoint runs FreshRSS's own installer
   (`do-install.php` + `create-user.php`), so allow a generous first-boot window
   before the login page settles — this is idempotent and only runs once. After
   logging in, **change the admin password in the FreshRSS UI** — rotating the
   Secret Manager value alone does not re-set an already-installed account.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and PVCs (if a block PVC is used
   instead of NFS):

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). GKE requires `min_instance_count >= 1` (no
   scale-to-zero), so the in-container feed-refresh cron (`CRON_MIN = */15`) always
   fires. Keep `max_instance_count` at `1` — a single pod owns the refresh cron and
   the file-based session/cache state on the shared NFS volume. Session affinity
   (`ClientIP`) is set by default to keep a client's requests on the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and the Deployment
   rolls out. Because the data dir is NFS-backed, the rollout uses the `Recreate`
   strategy (old pod terminates before the new one starts) rather than a rolling
   update, so two pods never write the shared volume at once — expect a brief gap
   in availability during an update. `application_version = "latest"` is pinned to
   a known-good tag at build time — pin it explicitly for production.

4. **Manage secrets and the database:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~freshrss"
   kubectl get jobs -n "$NS"          # db-init (and import job, if enabled)
   gcloud sql backups list --instance=<instance-name> --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=freshrss --database=freshrss --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics. `uptime_check_config`
   is disabled by default — enable it and review Monitoring → Uptime checks and
   Alerting → Policies if you want automated availability alerts.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with FreshRSS releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  is a TCP check on port 80; the liveness probe is an HTTP GET on `/` — a slow
  first-boot install (schema creation) can exhaust a too-tight threshold.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, `enable_cloudsql_volume =
  true` (Auth Proxy sidecar bound to `127.0.0.1:5432`), and the `db-init` job
  completed.
- **`db-init` job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Config/state resets on pod restart:** confirm `enable_nfs = true` (or a block
  PVC via the Group 7 StatefulSet variables) and `nfs_mount_path =
  /var/www/FreshRSS/data`; without persistent storage, `config.php` and per-user
  state are lost on every pod restart.
- **Rollout stuck on "Waiting for rollout to finish":** expected with `Recreate` —
  the old pod must fully terminate (releasing the NFS mount and DB locks) before
  the new one starts; a stuck termination usually means a lingering connection or
  a slow graceful-shutdown, not a bad image.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rules around `enable_nfs`,
`database_type`, and immutable `application_database_name`/`application_database_user`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database and user, Secret Manager secrets, and the
NFS-backed data directory contents. Resources owned by **Services_GCP** (the VPC,
GKE cluster, shared Cloud SQL instance, shared NFS server, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, NFS volume, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; `/status` responds; log in as `admin` and change the password |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate rollout), manage secrets/DB |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, `db-init`, NFS, and rollout-strategy issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
