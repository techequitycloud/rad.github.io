---
title: "Coder on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Coder on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Coder on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Coder is an open-source, self-hosted platform for provisioning remote development
environments ("workspaces") defined as code with Terraform. This lab takes you
through the full operational lifecycle of the **Coder on GKE Autopilot** module on
Google Cloud: deploy the control plane, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Coder product features such as templates and workspaces. For the complete list
of provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running Coder control-plane workload.
- Create the first admin account and verify the deployment is healthy.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Coder (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Coder_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the Coder control plane into the GKE Autopilot cluster,
   provisions a Cloud SQL (PostgreSQL 15) database with its Secret Manager
   password secret, a dedicated Cloud Storage bucket, mirrors the upstream
   `ghcr.io/coder/coder` image and wraps it with a cloud entrypoint via Cloud
   Build, and runs a one-shot database-initialisation job (`db-init`) that creates
   the empty database and role. Coder applies its own schema migrations on first
   server boot — there is no separate migrate job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep coder | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,ingress -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   The module provisions a Kubernetes Ingress backed by a reserved global static
   IP by default (`enable_custom_domain = true`, `reserve_static_ip = true`), so
   the address should stay stable across redeploys.

2. Confirm the service is healthy. Coder serves an unauthenticated health endpoint
   at `/healthz` (HTTP 200 once the server is up — allow a minute or two on a
   fresh deploy while first-boot schema migrations run; the startup probe allows
   up to 30 failures at a 15-second period to absorb this):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"
   curl -s "http://${EXTERNAL_IP}/api/v2/buildinfo"    # returns the deployed Coder version
   ```

3. Open `http://${EXTERNAL_IP}` (or your custom domain, if configured) in a
   browser. On first boot Coder presents the **setup page** — create the initial
   admin (owner) account with your name, email, and password. **Do this
   promptly**: the setup page is publicly reachable until the first account
   exists, and there is no auto-generated admin credential in Secret Manager (Coder
   self-generates its signing keys and stores them in PostgreSQL on first boot,
   not in Secret Manager). The only credential Secret Manager holds is the
   database password, which can be retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~coder" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

4. **Post-deploy next steps:** running actual workspaces requires a day-2 step —
   create a Coder template (Terraform) pointing at a compute target such as a
   Kubernetes cluster or cloud VM templates, and give the provisioner credentials
   for it. This module deploys the control plane only; it runs no workspaces on
   its own.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal pod
   autoscaler. The control plane is stateless, so it runs as a standard
   `Deployment` with a `RollingUpdate` strategy (no NFS-backed `Recreate`
   constraint):

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling is
   a configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Coder defaults to `min_instance_count = 1`,
   `max_instance_count = 5`: the stateless control plane can safely scale
   horizontally against the shared Cloud SQL database. `session_affinity =
   ClientIP` is set by default so a browser's WebSocket-heavy terminal/IDE
   session stays pinned to the same pod — an in-flight session does not migrate
   between pods if one is drained mid-session. Watch Cloud SQL `max_connections`
   if you raise `max_instance_count` significantly, since each replica opens its
   own connection pool.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pods. Coder's tags are semver-prefixed (e.g. `v2.24.1`);
   the module maps `latest` to a pinned tag rather than the non-existent
   `ghcr.io/coder/coder:latest`. Schema migrations run automatically on the new
   pods' first boot.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~coder"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~coder"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=coder --database=coder --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The custom entrypoint logs the
   resolved PostgreSQL connection and access URL at every start:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
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
platform-level diagnostics and do not change with Coder releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes both target `/health` with a 60-second initial delay; the
  startup probe allows up to 30 failures at a 15-second period to cover Coder's
  first-boot schema migration, so don't conclude failure too early.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance
  is `RUNNABLE`, the DB password secret materialised into the namespace via the
  Secret Store CSI driver, and the `db-init` job completed. GKE reaches Cloud SQL
  through the Auth Proxy sidecar on `127.0.0.1`; the entrypoint assembles
  `CODER_PG_CONNECTION_URL` with `sslmode=disable` (the proxy already
  TLS-terminates the connection) and percent-encodes the password.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service / Ingress has an
  assigned IP.
- **Image pull / build errors:** confirm the image exists in Artifact Registry
  and the node service account can pull it. `container_image_source` must be
  `custom` — the upstream `ghcr.io/coder/coder` image cannot assemble
  `CODER_PG_CONNECTION_URL`/`CODER_ACCESS_URL` on its own and fails to boot if
  deployed prebuilt. A `MANIFEST_UNKNOWN` on the base image means a non-existent
  version tag — Coder tags are semver-prefixed (`vX.Y.Z`), not `latest`.
- **Workspace builds queued but never start:** verify `CODER_ACCESS_URL` matches
  the URL developers actually use — a mismatch breaks workspace agent
  connections. Remember this module deploys the control plane only; workspaces
  additionally require a configured provisioner and compute target set up
  post-deploy through Coder's template system.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules never to rename
`application_database_name`/`application_database_user` after first deploy, and
never to mount `enable_nfs`'s `nfs_mount_path` over `/opt/coder`, which hides the
`coder` binary).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; `/healthz` returns 200; create the initial admin (owner) account in the UI |
| 3 — Operate | Manual | Inspect workload, scale (HPA-backed, min=1/max=5), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, image-pull/build, and stalled-workspace issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
